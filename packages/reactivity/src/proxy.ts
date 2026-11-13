import { logger } from "@vue3-learn/logger"

function isObject(val: unknown): val is object {
  return typeof val === 'object' && val !== null
}

const ITERATE_KEY = Symbol('ITERATE')
const MAP_KEY_ITERATE_KEY = Symbol('MAP_KEY_ITERATE_KEY')
const RAW = Symbol('RAW')
const TriggerType = {
  ADD: 'ADD',
  SET: 'SET',
  DELETE: 'DELETE',
} as const
type TTriggerType = typeof TriggerType[keyof typeof TriggerType]

// 待重写的数组方法
const ARRAY_FIND_METHODS = ['includes', 'indexOf', 'lastIndexOf'] as const
const ARRAY_OPRATION_METHODS = ['push', 'pop', 'shift', 'unshift', 'splice'] as const
type TArrayMethod = typeof ARRAY_FIND_METHODS[number] | typeof ARRAY_OPRATION_METHODS[number]
type TArrayInstrumentation = (this: any, ...args: any[]) => any
const arrayInstrumentations = {
} as Record<TArrayMethod, TArrayInstrumentation>

let isShouldTrack = true
function initArrayInstrumentations() {
  ARRAY_FIND_METHODS.forEach(methodName => {
    const originMethod = Array.prototype[methodName] as (...args: any[]) => any
    arrayInstrumentations[methodName] = function (this: any, ...args: any[]) {
      let res = originMethod.apply(this, args)
      // 代理对象找不到，在原始对象上再找一遍
      if (res === undefined || res === -1 || res === false) {
        res = originMethod.apply(this[RAW], args)
      }
      return res
    }
  })
  // 重写修改数组的方法
  ARRAY_OPRATION_METHODS.forEach(methodName => {
    const originMethod = Array.prototype[methodName] as (...args: any[]) => any
    arrayInstrumentations[methodName] = function (this: any, ...args: any[]) {
      isShouldTrack = false
      const res = originMethod.apply(this, args)
      isShouldTrack = true
      return res
    }
  })
}
initArrayInstrumentations()

function createReactive<T extends object>(obj: T, isShallow = false, isReadonly = false) {
  return new Proxy(obj, {
    get(target, key, receiver: any) {
      logger.label('info', 'Proxy::get', { color: '#722ed1', text: '#722ed1' })
        .info(`target=> ${JSON.stringify(target)}  key=> ${String(key)}`)
      if (key === RAW) {
        return target
      }

      // 拦截一些数组操作（查找方法）
      if (Array.isArray(target) && arrayInstrumentations.hasOwnProperty(key)) {
        return Reflect.get(arrayInstrumentations, key, receiver)
      }

      // 收集依赖时候，排除数组的迭代器（收集该属性并无任何业务意义）
      if (!isReadonly && key !== Symbol.iterator) {
        track(target, key)
      }

      // 用 Reflect 保证 getter 里的 this / receiver 语义正确
      const res = Reflect.get(target, key, receiver)

      if (isShallow) {
        return res
      }

      if (isObject(res)) {
        // return res
        return !isReadonly ? reactive(res) : readonly(res)
      }
      return res
    },
    set(target, key, newVal, receiver) {
      // const type: TTriggerType = Object.prototype.hasOwnProperty.call(target, key) ? 'SET' : 'ADD'
      const type: TTriggerType =
        Array.isArray(target) ? Number(key) < target.length ? 'SET' : 'ADD' :
          Object.hasOwn(target, key) ? 'SET' : 'ADD' // ES2022

      logger.label('info', `Proxy::set=>【${type}】`, { color: '#f108f1', text: '#f108f1' })
        .info(`target=> ${JSON.stringify(target)}  key=> ${String(key)} newVal=> ${newVal} ${receiver[RAW] === target}`)
      if (isReadonly) {
        console.warn(`修改失败，对象=>${JSON.stringify(target)}中的【${String(key)}】,是只读属性！`);
        return true
      }
      // const oldValue = target[key]
      const oldValue = Reflect.get(target, key, receiver)
      const res = Reflect.set(target, key, newVal, receiver)

      // 只有值真正变化时才触发更新，避免无意义的重复执行
      if (receiver[RAW] === target && !Object.is(oldValue, newVal)) {
        trigger(target, key, type, newVal as number)
      }
      return res
    },
    has(target, key) {
      console.log('has', target, key);
      // track(target, key)
      // TODO：使用代理对象强制访问，暂时解决target指向问题（ get bar() { return this.foo }）
      // p[key as any]
      return Reflect.has(target, key)
    },
    ownKeys(target) {
      track(target, !Array.isArray(target) ? ITERATE_KEY : 'length')
      return Reflect.ownKeys(target)
    },
    deleteProperty(target, key) {
      logger.label('info', `Proxy::deleteProperty`, { color: '#f1082f', text: '#f1082f' })
        .info(`target=> ${JSON.stringify(target)}  key=> ${String(key)}`)
      if (isReadonly) {
        console.warn(`删除失败，对象=>${JSON.stringify(target)}中的【${String(key)}】,是只读属性！`);
        return true
      }
      const isOwnKey = Object.prototype.hasOwnProperty.call(target, key)
      const res = Reflect.deleteProperty(target, key)
      if (isOwnKey && res) {
        trigger(target, key, TriggerType.DELETE)
      }

      return res
    }
  })
}

// 入参放宽为 object，数组等没有 string 索引签名的对象也能直接传入（如 reactive(['foo'])）
const reactiveMap = new Map()
export function reactive<T extends object>(obj: T) {
  let res = reactiveMap.get(obj)
  if (!res) {
    const isSetOrMap = obj instanceof Set || obj instanceof Map
    res = !isSetOrMap ? createReactive(obj) : createSetReactive(obj)
    reactiveMap.set(obj, res)
  }
  return res
}

function shallowReactive<T extends object>(obj: T) {
  return createReactive(obj, true)
}

function readonly<T extends object>(obj: T) {
  return createReactive(obj, false, true)
}

function shallowReadonly<T extends object>(obj: T) {
  return createReactive(obj, true, true)
}

const obj = { foo: 1, get bar() { return this.foo } } as const
// 依赖桶：target -> key -> 副作用函数集合
// 用 WeakMap 持有 target，target 被回收时其依赖也会随之释放，避免内存泄漏
// 注意：必须在使用它的 effect() 之前声明，否则会命中 TDZ 报 "Cannot access 'bucket' before initialization"
type TKey = string | symbol
type TDep = Set<Effect>
type TDepsMap = Map<string | symbol, TDep>
const bucket = new WeakMap<object, TDepsMap>()

// const p = reactive(obj)

/**
 * 当前正在执行的副作用函数，用于收集依赖
 */
type EffectOptions = { scheduler?: (fn?: () => void) => void, lazy?: boolean }
type Effect = (() => void) & { deps: Set<() => void>[], options?: EffectOptions }
let activeEffect: Effect | undefined
const effectStack: Effect[] = []
function effect(fn: () => void, options?: EffectOptions) {
  const effectFn = (() => {
    clearup(effectFn)
    activeEffect = effectFn
    effectStack.push(effectFn)
    const res = fn()
    effectStack.pop()
    activeEffect = effectStack[effectStack?.length - 1]
    return res
  }) as Effect
  effectFn.deps = [];
  effectFn.options = options
  if (!options?.lazy) {
    effectFn()
  } else {
    return effectFn
  }
}

function clearup(effectFn: (() => void) & { deps: Set<() => void>[] }) {
  for (let i = 0; i < effectFn.deps.length; i++) {
    const depSet = effectFn.deps[i]
    // console.log('depSet', depSet);
    depSet.delete(effectFn)
  }
  effectFn.deps.length = 0
}

// /**
//  *  1.测试proxy存在的一些不足（getter属性中的this指向问题）
//  */
// effect(() => {
//     logger.label('info', 'effect run', { color: '#f59607bd', text: '#f59607bd' })
//       .info(`${p.bar}`)
// })
// console.log(bucket);
// (p.foo as number)++

// /**
//  *  2.测试in操作符（effect函数收集in操作符副作用）
//  */
// effect(() => {
//   logger.label('info', 'effect run', { color: '#f59607bd', text: '#f59607bd' })
//     .info(`${'bar' in p}`)
// })
// console.log(bucket);
// (p.foo as number)++

// /**
//  *  3.测试for in循环（新增、删除属性后，effect函数收集for in操作符副作用）
//  */
// effect(() => {
//   logger.label('info', 'effect run', { color: '#f59607bd', text: '#f59607bd' })
//     .info(`${'副作用函数执行了'}`)
//   for (const key in p) {
//     console.log('key', key);
//   }
// })
// console.log(bucket);
// p.car = 6
//   ; (p.foo as number)++
// delete p.foo

// /**
//  *  4.测试set值为原值
//  */
// effect(() => {
//   logger.label('info', 'effect run', { color: '#f59607bd', text: '#f59607bd' })
//     .info(`${'副作用函数执行了' + p.foo}`)
// })
//   ; (p.foo as number) = 1


// /**
//  *  5.测试响应式对象继承，对effect收集副作用的影响
//  */
// const obj2 = {}
// const proto = { bar: 1 }
// const parent = reactive(proto)
// const child = reactive(obj2)
// Object.setPrototypeOf(child, parent)
// effect(() => {
//   logger.label('info', 'effect run', { color: '#f59607bd', text: '#f59607bd' })
//     .info(`${'副作用函数执行了'}`, child.bar)
// })
//   ; (child.bar as number) = 2
// console.log('bucket', bucket);

// /**
//  *  6.测试浅响应与深响应
//  */
// // 深响应
// // const deepReactive = reactive({ foo: { bar: 1 } }) as any
// // effect(() => {
// //   logger.label('info', 'effect run', { color: '#f59607bd', text: '#f59607bd' })
// //     .info(`${'【deepReactive】副作用函数执行了'}`, deepReactive.foo.bar)
// //   deepReactive.foo
// // })
// //   ; (deepReactive.foo as unknown) = { bar: 2 }
// //   ; (deepReactive.foo.bar as number) = 3

// // 浅响应
// const shallowReactiveObj = shallowReactive({ foo: { bar: 1 } }) as any
// effect(() => {
//   logger.label('info', 'effect run', { color: '#07edf5', text: '#07edf5' })
//     .info(`${'【shallowReactive】副作用函数执行了'}`, shallowReactiveObj.foo.bar)
//   shallowReactiveObj.foo
// })
//   ; (shallowReactiveObj.foo as unknown) = { bar: 2 }
//   ; (shallowReactiveObj.foo.bar as number) = 3
// console.log('bucket', bucket);


// /**
//  *  7.测试只读与浅只读
//  */
// // 只读
// const readonlyObj = readonly({ foo: { bar: 1 } }) as any
// effect(() => {
//   logger.label('info', 'effect run', { color: '#f59607bd', text: '#f59607bd' })
//     .info(`${'【readonlyObj】副作用函数执行了'}`, readonlyObj.foo.bar)
// })
//   ; (readonlyObj.foo as unknown) = { bar: 666 }
//   ; (readonlyObj.foo.bar as number) = 888
//   ;delete readonlyObj.foo.bar
// console.log('readonlyObj', readonlyObj);

// // 浅只读
// const shallowReadonlyObj = shallowReadonly({ foo: { bar: 1 } }) as any
// effect(() => {
//   logger.label('info', 'effect run', { color: '#f59607bd', text: '#f59607bd' })
//     .info(`${'【shallowReadonlyObj】副作用函数执行了'}`, shallowReadonlyObj.foo.bar)
// })
//   ; (shallowReadonlyObj.foo as unknown) = { bar: 666 }
//   ; (shallowReadonlyObj.foo.bar as number) = 888
// console.log('shallowReadonlyObj', shallowReadonlyObj);
// console.log('bucket', bucket);


// =============================================================================================================== \\


/**
 *  8.代理数组
 */
// // 1.长度改变，导致length隐式改变
// const arr = reactive(['foo'])
// effect(() => {
//   logger.label('info', 'effect run', { color: '#f59607bd', text: '#f59607bd' })
//     .info(`${'【arr::副作用函数执】length=>'}`, arr.length)
// })
// arr[1] = 'bar'
// console.log('bucket', bucket);

// // 2.length改变，导致索引大于该length元素受影响
// const arr2 = reactive(['foo'])
// effect(() => {
//   logger.label('info', 'effect run', { color: '#f59607bd', text: '#f59607bd' })
//     .info(`${'【arr2::副作用函数执行了]'}`, arr2[0])
//   arr2[1]
//   arr2[3]
//   arr2[7]
//   arr2[8]
// })

// arr2.length = 5
// console.log('bucket', bucket);


// 3.遍历数组
// // 3.1 for...in
// const arr3 = reactive(['foo'])
// effect(() => {
//   logger.label('info', 'effect run', { color: '#f59607bd', text: '#f59607bd' })
//     .info(`${'【arr3::副作用函数执行了]'}`)
//   for (const key in arr3) {
//     logger.info(key);
//   }
// })
// arr3[1] = 'bar'
// arr3.length = 0
// console.log('bucket', bucket);

// // 3.2 for...of
// const arr4 = reactive<(number | string)[]>([0, 2, 4, 6, 8, 10])
// effect(() => {
//   logger.label('info', 'effect run', { color: '#f59607bd', text: '#f59607bd' })
//     .info(`${'【arr4::副作用函数执行了]'}`)
//   for (const val of arr4) {
//     logger.info(val);
//   }
// })

// arr4[1] = 'bar'
// arr4.length = 0
// console.log('bucket', bucket);

// 3.3 数组的查找方法
// const arr5 = reactive<(number | string)[]>([0, 2, 4, 6, 8, 10])
// effect(() => {
//   logger.label('info', 'effect run', { color: '#f59607bd', text: '#f59607bd' })
//     .info(`${'【arr5::副作用函数执行了】=>arr5.includes(6)'} ${arr5.includes(6)}`)
// })

// // arr5[3] = 3
// const obj2 = {}
// const arr = reactive([obj2])
// logger.info(`arr.includes(arr[0])=> ${arr.includes(arr[0])}`);
// logger.info(`arr.includes(obj)=> ${arr.includes(obj2)}`);
// logger.info(`arr.indexOf(obj)=> ${arr.indexOf(obj2)}`);
// logger.info(`arr.lastIndexOf(obj)=> ${arr.lastIndexOf(obj2)}`);

// // 3.4 隐式修改数组长度的原型方法
// // push影响两个独立的effect函数
// const arr6 = reactive([])
// effect(() => {
//   logger.label('info', 'effect run', { color: '#f59607bd', text: '#f59607bd' })
//     .info(`${'【arr6::副作用[1]函数执行了】=>arr5.includes(6)'} ${arr6.push(1)}`)
// })

// effect(() => {
//   logger.label('info', 'effect run', { color: '#f59607bd', text: '#f59607bd' })
//     .info(`${'【arr6::副作用[2]函数执行了】=>arr5.includes(6)'} ${arr6.push(1)}`)
// })
// console.log('bucket', bucket);


/**
 *  9.代理Set和Map
 */
const warp = (val: unknown, isShallow = false) => !isObject(val) || isShallow ? val : reactive(val)
function iterationMethod(this: any) {
  const target = this[RAW]
  const itr = target[Symbol.iterator]()
  track(target, ITERATE_KEY)

  return {
    // 迭代器协议
    next() {
      const { value, done } = itr.next()
      return { value: value ? [warp(value[0]), warp([value[1]])] : [], done: done }
    },
    // 可迭代协议
    [Symbol.iterator]() {
      return this
    }
  }
}
function valuesIterationMethod(this: any) {
  const target = this[RAW]
  const itr = target.values()
  track(target, ITERATE_KEY)

  return {
    // 迭代器协议
    next() {
      const { value, done } = itr.next()

      return { value: warp(value), done: done }
    },
    // 可迭代协议
    [Symbol.iterator]() {
      return this
    }
  }
}
function keysIterationMethod(this: any) {
  const target = this[RAW]
  const itr = target.keys()
  track(target, MAP_KEY_ITERATE_KEY)

  return {
    // 迭代器协议
    next() {
      const { value, done } = itr.next()
      return { value: warp(value), done: done }
    },
    // 可迭代协议
    [Symbol.iterator]() {
      return this
    }
  }
}

function createMutableInstrumentations(isShallow: boolean = false, isReadonly: boolean = false) {
  return {
    // Set类型数据方法
    add: function (this: any, value: any) {
      const rawObj = this[RAW]
      const hasKey = rawObj.has(value)
      const res = (rawObj as Set<any>).add(value)
      if (!hasKey) {
        trigger(rawObj, ITERATE_KEY, 'ADD')
      }
      return res
    },
    delete: function (this: any, value: any) {
      const rawObj = this[RAW]
      const hasKey = rawObj.has(value)
      const res = (rawObj as Set<any>).delete(value)
      if (hasKey) {
        trigger(rawObj, ITERATE_KEY, "DELETE")
      }
      return res
    },

    // Map类型数据方法
    get: function (this: any, key: any) {
      const rawObj = this[RAW]
      const hasKey = rawObj.has(key)
      track(rawObj, key)
      console.log('isShallow', isShallow);
      console.log('isReadonly', isReadonly);

      if (hasKey) {
        const res = rawObj.get(key)
        return !isObject(res) || isShallow ? res : reactive(res)
      }

    },
    set: function (this: any, key: any, value: any) {
      const rawObj = this[RAW]
      const hasKey = rawObj.has(key)
      const oldValue = rawObj.get(key)
      // 如果被设置的值为响应式的则取原始值（防止将响应式数据，设置到原始Map中造成污染）
      const rawValue = value[RAW] || value
      const res = rawObj.set(key, rawValue)
      if (!hasKey) {
        trigger(rawObj, key, 'ADD')
      } else if (oldValue !== value || (oldValue === oldValue && value === value)) {
        trigger(rawObj, key, 'SET')
      }
      return res
    },
    forEach: function (this: any, callback: (value: any, key: any, self: any) => void, thisArg: any) {
      // const warp = (val: unknown) => !isObject(val) || isShallow ? val : reactive(val)
      const rawObj = this[RAW]
      track(rawObj, ITERATE_KEY)
      rawObj.forEach((value: any, key: any, self: any) => {
        callback.call(thisArg, warp(value, isShallow), warp(key, isShallow), self)
      })
    },
    [Symbol.iterator]: iterationMethod,
    entries: iterationMethod,
    values: valuesIterationMethod,
    keys: keysIterationMethod
  } as const
}
type TMutableInstrumentations = ReturnType<typeof createMutableInstrumentations>

// 四种组合各缓存一份，避免每次创建代理都重新生成方法表
const deepInstrumentations: TMutableInstrumentations = createMutableInstrumentations()
const shallowInstrumentations: TMutableInstrumentations = createMutableInstrumentations(true, false)
const readonlyInstrumentations: TMutableInstrumentations = createMutableInstrumentations(false, true)
const shallowReadonlyInstrumentations: TMutableInstrumentations = createMutableInstrumentations(true, true)

function getMutableInstrumentations(isShallow: boolean, isReadonly: boolean) {
  if (isShallow) {
    return isReadonly ? shallowReadonlyInstrumentations : shallowInstrumentations
  }
  return isReadonly ? readonlyInstrumentations : deepInstrumentations
}
function createSetReactive<T extends Set<any> | Map<any, any>>(obj: T, isShallow = false, isReadonly = false) {
  const instrumentations = getMutableInstrumentations(isShallow, isReadonly)
  return new Proxy(obj, {
    get(target, key, receiver) {
      if (key === RAW) {
        return target
      }

      if (key === 'size') {
        track(target, ITERATE_KEY)
        return Reflect.get(target, key, target)
      }

      if (Object.prototype.hasOwnProperty.call(instrumentations, key)) {
        return Reflect.get(instrumentations, key, receiver)
      }
      return Reflect.get(target, key, receiver)
    },
  })
}

// // 9.1 建议响应式联系
// const s = new Set([1, 3, 5])
// const rs1 = reactive(s)
// effect(() => {
//   logger.label('info', 'effect run', { color: '#f59607bd', text: '#f59607bd' })
//     .info(`${'【rs1::副作用函数执行了】=>arr5.includes(6)'} ${rs1.size}`)
// })
// // console.log(rs1);
// console.log(rs1.add(6));
// console.log(rs1.delete(3));
// console.log('bucket=>', bucket)

// // 9.2 避免污染原始数据
// const p = reactive(new Map([['key', 1]]))

// effect(() => {
//   console.log()
//   logger.label('info', 'effect run', { color: '#f59607bd', text: '#f59607bd' })
//     .info(`【p.get('key')】=> ${p.get('key')}`)
// })
// p.set('key', 1) // 触发响应

// // 原始 Map 对象 m
// const m = new Map()
// // p1 是 m 的代理对象
// const p1 = reactive(m)
// // p2 是另外一个代理对象
// const p2 = reactive(new Map())
// // 为 p1 设置一个键值对，值是代理对象 p2
// p1.set('p2', p2)

// effect(() => {
//   // 注意，这里我们通过原始数据 m 访问 p2
//    logger.label('info', 'effect run', { color: '#f59607bd', text: '#f59607bd' })
//     .info(`【m.get('p2').size】=> ${m.get('p2').size}`)
// })
// // 注意，这里我们通过原始数据 m 为 p2 设置一个键值对 foo --> 1
// m.get('p2').set('foo', 1)

// // 9.3 处理forEach
// // eg1:
// // const p = reactive(new Map([
// //   [{ key: 1 }, { value: 2 }]
// // ]))
// // effect(() => {
// //   p.forEach((value: any, key: any, map: any) => {
// //     logger.label('info', 'effect run', { color: '#f59607bd', text: '#f59607bd' })
// //       .info(`【value, key, map】=> ${JSON.stringify(value)} ${JSON.stringify(key)} ${JSON.stringify(map)}`)
// //   });
// // })
// // p.set({ key: 3 }, { value: 6 })

// // eg2:
// const key = { key: 1 }
// const value = new Set([1, 2, 3])
// const p = reactive(new Map([
//   [key, value]
// ]))
// effect(() => {
//   p.forEach(function (value: any, key: any, map: any) {
//     logger.label('info', 'effect run', { color: '#f59607bd', text: '#f59607bd' })
//       .info(`【value.size, key, map】=> ${JSON.stringify(value.size)} ${JSON.stringify(key)} ${JSON.stringify(map)}`)
//     console.log(value, key, map, this);

//   }, { a: 1, b: 2 });
// })
// p.get(key).delete(2)
// p.set(key, new Set([4, 5, 6, 7, 8, 9]))

// 9.4 迭代器方法
// // eg1:
// const p = reactive(new Map([
//   ['key1', 'value1'],
//   ['key2', 'value2']
// ]))
// effect(() => {
//   logger.label('info', 'effect run', { color: '#f59607bd', text: '#f59607bd' }).info('for of')
//   for (const [key, value] of p) {
//     console.log('1111111', key, value);
//   }
//   for (const [key, value] of p.entries()) {
//     console.log('2222222', key, value);
//   }
// })
// p.set({ key: 3 }, { value: 6 })

// // eg2: values
// const p = reactive(new Map([
//   ['key1', 'value1'],
//   ['key2', 'value2']
// ]))

// effect(() => {
// logger.label('info', 'effect run', { color: '#f59607bd', text: '#f59607bd' }).info('for of p.values')
//   for (const value of p.values()) {
//     console.log(value) // key1 key2
//   }
// })
// p.set('key2', 'value3') 

// eg3: keys
const p = reactive(new Map([
  ['key1', 'value1'],
  ['key2', 'value2']
]))

effect(() => {
  logger.label('info', 'effect run', { color: '#f59607bd', text: '#f59607bd' }).info('for of p.keys')
  for (const value of p.keys()) {
    console.log(value)
  }
})
p.set('key2', 'value3') // 不会触发响应
p.set('key3', 'value4') // 能够触发响应








// const o = { foo: 1 }
// const p2 = new Proxy(o, {
//   deleteProperty(target, key) {
//     console.log(`${target} 删除 ${key}`);
//     return Reflect.deleteProperty(target, key)
//   }
// })
// console.log(p2.foo);
// console.log(delete p2.foo);


// ; (p.foo as number)++

// /**
//  * 测试computed计算属性
//  */
// function computed(getter: () => unknown) {
//   let value: any;
//   let dirty = true;
//   const effectFn = effect(getter, {
//     lazy: true,
//     // 当依赖发生变化时，标记为脏，但不立即执行，等待下次访问时再计算
//     scheduler: () => {
//       dirty = true
//       logger.label('info', 'computed value invalidated', { color: '#722ed1', text: '#722ed1' }).info(`dirty=> ${dirty}`)
//       trigger(computedObj, 'value')
//     }
//   })

//   const computedObj = {
//     get value() {
//       if (dirty) {
//         value = effectFn!()
//         dirty = false

//         logger.label('info', 'computed value run', { color: '#722ed1', text: '#722ed1' }).info(`dirty=> ${dirty}`)
//       }
//       track(computedObj, 'value')
//       return value
//     }
//   }
//   return computedObj
// }

// /**
//  * 测试watch属性侦听器
//  */
// interface WatchOptions {
//   immediate?: boolean;
//   flush?: 'post'
// }
// function watch(source: any, callback: (newVal: any, oldVal: any, onValidate?: (fn?: () => void) => void) => void, options?: WatchOptions) {
//   let getter: () => void;
//   let newValue, oldValue: any;
//   if (typeof source === 'function') {
//     getter = source
//   } else {
//     getter = () => traverse(source)
//   }

//   let clearup: () => void;
//   function onValidate(fn?: () => void) {
//     clearup = fn!
//   }

//   const job = (fn?: () => void) => {
//     // 两种调用方式等价
//     console.log(watchEffectFn === fn);
//     // newValue = fn!()
//     newValue = watchEffectFn!()
//     clearup && clearup()
//     callback(newValue, oldValue, onValidate)
//     oldValue = newValue
//   }

//   const watchEffectFn = effect(getter, {
//     lazy: true,
//     scheduler: (fn) => {
//       if (options?.flush === 'post') {
//         const p = Promise.resolve()
//         p.then(() => job(fn))
//       } else {
//         job(fn)
//       }
//     }
//   })

//   if (options?.immediate) {
//     job()
//   } else {
//     oldValue = watchEffectFn!()
//   }
// }

// function traverse(obj: any, seen = new Set()) {
//   if (typeof obj !== 'object' || obj === null) {
//     return
//   }
//   if (seen.has(obj)) {
//     return
//   }
//   seen.add(obj)
//   for (const key in obj) {
//     traverse(obj[key], seen)
//   }
//   return obj
// }

function track(target: object, key: TKey) {
  if (!activeEffect || !isShouldTrack) {
    console.log(`no active effect for key: ${String(key)}`);
    return
  }
  let depsMap = bucket.get(target)
  if (!depsMap) {
    bucket.set(target, (depsMap = new Map<string | symbol, TDep>()))
  }

  let deps = depsMap.get(key)
  if (!deps) {
    depsMap.set(key, (deps = new Set<Effect>()))
  }
  deps.add(activeEffect)
  activeEffect.deps.push(deps)
  logger.label('info', 'tracked').setLevel('info').info(`key=> ${String(key)}`)
  // console.log(`tracked effect for key: ${key}`);
}

function trigger(target: object, key: string | symbol, type: TTriggerType = 'SET', newVal?: number) {
  const depsMap = bucket.get(target)
  if (!depsMap) {
    return
  }
  const effects = depsMap.get(key)
  const effectsToRun = new Set<Effect>()
  effects && effects.forEach(effect => {
    if (effect !== activeEffect) {
      effectsToRun.add(effect)
    }
  })

  // 获取ownKeys（for in、删除属性）触发的副作用;map类型forEach遍历时候，set也需要重新执行
  if (type === 'ADD' || type === 'DELETE' || (type === 'SET' && Object.prototype.toString.call(target) === '[object Map]')) {
    const iterateEffects = depsMap.get(ITERATE_KEY)
    iterateEffects && iterateEffects.forEach(effect => {
      if (effect !== activeEffect) {
        effectsToRun.add(effect)
      }
    })
  }

  // 当Map类型数据新增删除时候，触发keys方法收集的MAP_KEY_ITERATE_KEY
  if ((type === 'ADD' || type === 'DELETE') && Object.prototype.toString.call(target) === '[object Map]') {
    const iterateEffects = depsMap.get(MAP_KEY_ITERATE_KEY)
    iterateEffects && iterateEffects.forEach(effect => {
      if (effect !== activeEffect) {
        effectsToRun.add(effect)
      }
    })
  }


  // 如果是数组，且为新增数组项目（则隐式影响到所有访问数组长度的副作用函数）
  if (Array.isArray(target) && type === 'ADD') {
    const lengthEffect = depsMap.get('length')
    lengthEffect && lengthEffect.forEach(effect => {
      if (effect !== activeEffect) {
        effectsToRun.add(effect)
      }
    })
  }

  // 如果是数组，且为length改变会影响到所有，副作用函数中index>=length的元素
  if (Array.isArray(target) && key === 'length') {
    depsMap?.forEach((sets, index) => {
      // 防止Symbol(Symbol.iterator)，使用Number转换失败
      if (typeof index !== 'symbol' && Number(index) >= Number(newVal)) {
        sets.forEach(effect => {
          if (effect !== activeEffect) {
            effectsToRun.add(effect)
          }
        })
      }
    })
    // const lengthEffect = depsMap.get('length')
    // lengthEffect && lengthEffect.forEach(effect => {
    //   if (effect !== activeEffect) {
    //     effectsToRun.add(effect)
    //   }
    // })
  }


  if (effectsToRun.size) {
    logger.label('success', 'triggered').setLevel('success').success(`${JSON.stringify(target)} key=> ${String(key)}`)
    effectsToRun.forEach(effect => {
      if (effect.options && effect.options.scheduler) {
        effect.options.scheduler(effect)
      } else {
        effect()
      }
    })
  }
  // deps && deps.forEach(effect => effect())
}
console.log("------------#Proxy Start#------------")