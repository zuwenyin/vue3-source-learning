import { logger } from "@vue3-learn/logger"

const ITERATE_KEY = Symbol('ITERATE')
const RAW = Symbol('RAW')
const TriggerType = {
  ADD: 'ADD',
  SET: 'SET',
  DELETE: 'DELETE',
} as const
type TTriggerType = typeof TriggerType[keyof typeof TriggerType]

function createReactive(obj: Record<string | symbol, unknown>, isShallow = false) {
  return new Proxy(obj, {
    get(target: Record<string, unknown>, key: string | symbol, receiver: Record<string, unknown>) {
      logger.label('info', 'Proxy::get', { color: '#722ed1', text: '#722ed1' })
        .info(`target=> ${JSON.stringify(target)}  key=> ${String(key)}`)
      if (key === RAW) {
        return target
      }
      track(target, key)
      // 用 Reflect 保证 getter 里的 this / receiver 语义正确
      const res = Reflect.get(target, key, receiver)

      if (isShallow) {
        return res
      }

      if (typeof res === 'object' && res !== null) {
        return reactive(res)
      }
      return res
    },
    set(target: Record<string, unknown>, key: string, value: unknown, receiver) {
      // const type: TTriggerType = Object.prototype.hasOwnProperty.call(target, key) ? 'SET' : 'ADD'
      const type: TTriggerType = Object.hasOwn(target, key) ? 'SET' : 'ADD' // ES2022

      logger.label('info', `Proxy::set=>【${type}】`, { color: '#f108f1', text: '#f108f1' })
        .info(`target=> ${JSON.stringify(target)}  key=> ${String(key)} ${receiver[RAW] === target}`)

      const oldValue = target[key]
      const res = Reflect.set(target, key, value, receiver)

      // 只有值真正变化时才触发更新，避免无意义的重复执行
      if (receiver[RAW] === target && !Object.is(oldValue, value)) {
        trigger(target, key, type)
      }
      return res
    },
    has(target, key) {
      console.log('has', target, key);
      // track(target, key)
      // TODO：使用代理对象强制访问，暂时解决target指向问题（ get bar() { return this.foo }）
      p[key as any]
      return Reflect.has(target, key)
    },
    ownKeys(target) {
      track(target, ITERATE_KEY)
      return Reflect.ownKeys(target)
    },
    deleteProperty(target, key) {
      logger.label('info', `Proxy::deleteProperty`, { color: '#f1082f', text: '#f1082f' })
        .info(`target=> ${JSON.stringify(target)}  key=> ${String(key)}`)
      const isOwnKey = Object.prototype.hasOwnProperty.call(target, key)
      const res = Reflect.deleteProperty(target, key)
      if (isOwnKey && res) {
        trigger(target, key, TriggerType.DELETE)
      }

      return res
    }
  })
}

function reactive(obj: Record<string | symbol, unknown>) {
  return createReactive(obj)
}

function shallowReactive(obj: Record<string | symbol, unknown>) {
  return createReactive(obj, true)
}

const obj = { foo: 1, get bar() { return this.foo } } as const
// 依赖桶：target -> key -> 副作用函数集合
// 用 WeakMap 持有 target，target 被回收时其依赖也会随之释放，避免内存泄漏
// 注意：必须在使用它的 effect() 之前声明，否则会命中 TDZ 报 "Cannot access 'bucket' before initialization"
const bucket = new WeakMap<Record<string | symbol, unknown>, Map<string | symbol, Set<Effect>>>()

const p = reactive(obj)

/**
 * 当前正在执行的副作用函数，用于收集依赖
 */
type EffectOptions = { scheduler?: (fn?: () => void) => void, lazy?: boolean }
type Effect = (() => void) & { deps: Set<() => void>[], options?: EffectOptions }
let activeEffect: Effect | undefined
const effectStack: Effect[] = []
function effect(fn: () => void, options?: EffectOptions) {
  const effectFn: Effect = () => {
    clearup(effectFn)
    activeEffect = effectFn
    effectStack.push(effectFn)
    const res = fn()
    effectStack.pop()
    activeEffect = effectStack[effectStack?.length - 1]
    return res
  }
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

/**
 *  6.测试浅响应与深响应
 */
// 深响应
// const deepReactive = reactive({ foo: { bar: 1 } }) as any
// effect(() => {
//   logger.label('info', 'effect run', { color: '#f59607bd', text: '#f59607bd' })
//     .info(`${'【deepReactive】副作用函数执行了'}`, deepReactive.foo.bar)
//   deepReactive.foo
// })
//   ; (deepReactive.foo as unknown) = { bar: 2 }
//   ; (deepReactive.foo.bar as number) = 3

// 浅响应
const shallowReactiveObj = shallowReactive({ foo: { bar: 1 } }) as any
effect(() => {
  logger.label('info', 'effect run', { color: '#07edf5', text: '#07edf5' })
    .info(`${'【shallowReactive】副作用函数执行了'}`, shallowReactiveObj.foo.bar)
  shallowReactiveObj.foo
})
  ; (shallowReactiveObj.foo as unknown) = { bar: 2 }
  ; (shallowReactiveObj.foo.bar as number) = 3
console.log('bucket', bucket);












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

function track(target: Record<string, unknown>, key: string | symbol) {
  if (!activeEffect) {
    console.log(`no active effect for key: ${String(key)}`);
    return
  }
  let depsMap = bucket.get(target)
  if (!depsMap) {
    bucket.set(target, (depsMap = new Map<string, Set<Effect>>()))
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

function trigger(target: Record<string, unknown>, key: string | symbol, type: TTriggerType = 'SET') {
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

  // 获取ownKeys（for in、删除属性）触发的副作用
  if (type === 'ADD' || type === 'DELETE') {
    const iterateEffects = depsMap.get(ITERATE_KEY)
    iterateEffects && iterateEffects.forEach(effect => {
      if (effect !== activeEffect) {
        effectsToRun.add(effect)
      }
    })
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