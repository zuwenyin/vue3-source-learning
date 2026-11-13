import logger from '@vue3-learn/logger'
import { reactive, effect, proxyRefs, toRefs, ref, type HtmlHTMLAttributes } from 'vue'

// function renderer(domStr: string, container: HTMLElement) {
//   container.innerHTML = domStr
// }

// const obj = ref({ foo: 1, bar: 2 })
// effect(() => {
//   logger.label('info', 'effect run', { color: '#f59607bd', text: '#f59607bd' }).
//     info('foo=>', obj.value.foo)
//   renderer(`<h1>${obj.value.foo}</h1>`, document.querySelector('#app')!)
// })

// setTimeout(() => {
//   obj.value.foo = 6688
// }, 2000);
// console.log(Vue);

interface VNode {
  type: string | symbol;
  props?: Record<string, any> & {
    class?: string | Record<string, boolean> | (string | Record<string, boolean>)[]
  },
  children: string | VNode[],
  el?: HTMLElement
  key?: number | string
}
interface Container extends HTMLElement {
  _vnode?: VNode
}
interface RendererOptions {
  // 创建元素
  createElement: (tag: string) => HTMLElement | any;
  // 设置元素文字
  setElementText: (el: Container, text: string) => void
  // 在父元素指定位置插入元素
  insert: (el: HTMLElement, parent: HTMLElement, anchor?: Node | null) => void
  // 更新元素属性（prevValue 为 null 表示首次设置）
  patchProps: (el: HTMLElement & {
    _evi: Record<string,
      ((...args: any[]) => void | ((...args: any[]) => void)[])
      & { value?: any, attached?: number }>
  },
    key: string,
    prevValue: any, nextValue: any) => void,
  // 创建文字节点
  createText: (tag: string) => HTMLElement | any;
  // 设置文字节点
  setText: (el: HTMLElement, text: string) => void
  // 创建注释节点
  createComment: (tag: string) => HTMLElement | any;
  // 设置注释节点
  setComment: (el: HTMLElement, text: string) => void
}

const Text = Symbol("Text") // 文本类型的vNode的type
const Comment = Symbol("Comment") // 注释类型的vNode的type
const Fragment = Symbol("Fragment") // 片段类型的vNode的type

function unmount(vNode: VNode) {
  const el = vNode.el
  // fragment卸载
  if (vNode.type === Fragment) {
    if (Array.isArray(vNode.children)) {
      vNode.children.forEach(c => unmount(c))
    }
    return
  }

  const parent = el?.parentNode
  if (parent) {
    parent.removeChild(el)
  }
}

function createRenderer(options: RendererOptions) {
  const { createElement, setElementText, insert, patchProps, createText, setText, createComment, setComment } = options
  function render(vNode: VNode, container: Container) {
    if (vNode) {
      patch(container._vnode!, vNode, container)
    } else {
      // 没有新的vNode，但是有旧的为清空操作
      if (container._vnode) {
        unmount(container._vnode)
      }
    }
    container._vnode = vNode
  }

  /**
   * 
   * @param n1 旧的vNode
   * @param n2 新的vNode
   * @param container 待更新的容器
   */
  function patchChildren(n1: VNode, n2: VNode, container: HTMLElement) {
    // 新的子节点为【文本类型】
    if (typeof n2.children === 'string') {
      // 旧的子节点为【多节点】
      if (Array.isArray(n2.children)) {
        n2.children.forEach(c => unmount(c))
      }
      setElementText(container, n2.children)
    } else if (Array.isArray(n2.children)) {
      // 新的子节点为【多节点】

      // todo 新旧子节点均为【多节点】待diff
      if (Array.isArray(n1.children)) {
        // // todo 暂时先简单实现（全量卸载和渲染）
        // n1.children.forEach(c => unmount(c))
        // n2.children.forEach(c => patch(null, c, container))
        const oldChildren = n1.children
        const newChildren = n2.children
        for (let i = 0; i < newChildren.length; i++) {
          const newVNode = newChildren[i]
          for (let j = 0; j < oldChildren.length; j++) {
            const oldVNode = oldChildren[j]
            if (oldVNode.key === newVNode.key) {
              const currentIndex = [...container.childNodes].indexOf(oldVNode.el!)
              if (currentIndex > -1 && currentIndex !== i) {
                console.log('移动旧dom顺序...', container.insertBefore(oldVNode.el!, container.childNodes[i]!));
              }

              console.log(`oldNodeIndex=>newNodeIndex : ${j}=>${i}`);

              patch(oldVNode, newVNode, container)
              break
            }
          }
        }

      } else {
        // 旧的节点时【文本类型】或者【空节点】
        setElementText(container, "") // 先清空旧节点
        n2.children.forEach(c => patch(null, c, container)) // 再渲染新节点
      }
    } else {
      // 新的子节点为【空节点】

      // 旧子节点为【多节点】清空
      if (Array.isArray(n1.children)) {
        n1.children.forEach(c => unmount(c))
      } else {
        // 旧的节点时【文本类型】或者【空节点】
        setElementText(container, "")
      }
    }
  }

  // 更新元素
  function patchElement(n1: VNode, n2: VNode) {
    const el = n2.el = n1.el!

    const oldProps = n1.props || {}
    const newProps = n2.props || {}

    // 更新新增或变化的属性
    for (const key in newProps) {
      if (newProps[key] !== oldProps[key]) {
        patchProps(el as any, key, oldProps[key], newProps[key])
      }
    }

    // 删除旧属性
    for (const key in oldProps) {
      if (!(key in newProps)) {
        patchProps(el as any, key, oldProps[key], null)
      }
    }

    // 更新子节点
    patchChildren(n1, n2, el)
  }

  function patch(n1: VNode | null, n2: VNode, container: Container) {
    // 更新，但是不可复用
    if (n1 && n1?.type !== n2.type) {
      unmount(n1!)
      n1 = null
    }

    const { type } = n2
    if (typeof type === 'string') {
      // string表示渲染正常html元素
      if (!n1) {
        // 没有旧的vNode则为首次渲染
        mountElement(n2, container)
      } else {
        patchElement(n1, n2)
      }
    } else if (type === Text) {
      // 文本节点
      if (!n1) {
        const el = n2.el = createText(n2.children as string)
        insert(el, container)
      } else {
        const el = n2.el = n1!.el
        if (n1!.children !== n2.children) {
          // el!.nodeValue = n2.children as string
          setText(el!, n2.children as string)
        }
      }
    } else if (type === Comment) {
      // 注释节点
      if (!n1) {
        const el = n2.el = createComment(n2.children as string)
        insert(el, container)
      } else {
        const el = n2.el = n1!.el
        if (n1!.children !== n2.children) {
          setComment(el!, n2.children as string)
        }
      }
    } else if (type === Fragment) {
      // 片段节点
      if (Array.isArray(n2.children)) {
        if (!n1) {
          n2.children.forEach(c => {
            mountElement(c, container)
          })
        } else {
          // 不关注片段节点，直接更新子节点即可
          patchChildren(n1, n2, container)
        }
      }

    } else if (typeof type === 'object') {
      // todo 渲染组件
    }

  }

  function mountElement(vNode: VNode, container: Container) {
    const el = vNode.el = createElement(vNode.type)
    if (typeof vNode.children === 'string') {
      setElementText(el, vNode.children)
    } else if (Array.isArray(vNode.children)) {
      vNode.children.forEach(node => {
        patch(null, node, el)
      });
    }

    // 有属性则处理
    const props = vNode.props
    if (props) {
      for (const key in props) {
        const _key = key as keyof typeof props
        patchProps(el, _key, null, props[_key])
      }
    }

    insert(el, container)
  }

  return { render }
}

function shouldSetAsProps(el: HTMLElement, key: string) {
  if (key === 'form' && el.tagName === 'INPUT') {
    return false
  }
  return key in el
}

function normalizeClass(propsClass:
  string |
  Record<string, boolean> |
  (string | Record<string, boolean>)[],
  classNameArr: string[] = []) {
  if (typeof propsClass === 'string') {
    classNameArr.push(propsClass)
  }

  if (Array.isArray(propsClass)) {
    propsClass.forEach(item => {
      normalizeClass(item, classNameArr)
    })
  } else if (typeof propsClass === 'object' && propsClass !== null) {
    Object.keys(propsClass).forEach(key => {
      const value = propsClass[key]
      value && (classNameArr.push(key))
    })
  }

  return classNameArr.join(' ')
}

const renderer = createRenderer({
  // 创建元素
  createElement(tag: string) {
    return document.createElement(tag)
  },
  // 设置元素文字
  setElementText(el: Container, text: string) {
    el.innerText = text
  },
  // 在父元素指定位置插入元素
  insert(el: HTMLElement, parent: HTMLElement, anchor: Node | null = null) {
    parent.insertBefore(el, anchor)
  },
  patchProps(el, key: string, prevValue: any, nextValue: any) {
    if (/^on/.test(key)) {
      const invokes = el._evi || (el._evi = {})
      let invoke = invokes[key]
      const eventName = key.slice(2).toLocaleLowerCase()
      if (nextValue) {
        if (!invoke) {
          invoke = el._evi[key] = (e: Event) => {
            const invValue = invoke.value
            // 事件执行时间早于事件绑定时间，则不执行
            if (e.timeStamp < invoke.attached!) {
              return
            }
            if (Array.isArray(invValue)) {
              invValue.forEach(cb => cb(e))
            } else {
              invoke.value(e)
            }
          }
          invoke.value = nextValue
        } else {
          // 更新当前invoke存储的事件
          invoke.value = nextValue
        }
        invoke.attached = performance.now()

        el.addEventListener(eventName, invoke)
      } else {
        // 没有新的props应该移除旧的事件
        el.removeEventListener(eventName, invoke)
      }

    } else if (key === 'class') {
      // 该方法设置class性能最好
      el.className = normalizeClass(nextValue)
    } else if (shouldSetAsProps(el, key)) {
      // dom的properties中存在该html的attributes
      // HTMLElement 上有大量只读属性，这里按 Vue 的做法当作可写索引签名处理
      const target = el as unknown as Record<string, any>
      const type = typeof target[key]
      if (type === 'boolean' && nextValue === '') {
        target[key] = true
      } else {
        target[key] = nextValue
      }
    } else {
      el.setAttribute(key, nextValue)
    }
  },
  createText(text: string) {
    return document.createTextNode(text)
  },
  setText(el: Container, text: string) {
    el.nodeValue = text
  },
  createComment(text: string) {
    return document.createComment(text)
  },
  setComment(el: Container, text: string) {
    el.nodeValue = text
  },
})

/**
 * 1.渲染测试
 */
// const vNode: VNode = {
//   type: 'div',
//   props: {
//     id: 'container',
//     class: 'container'
//   },
//   children: [
//     {
//       type: 'h2',
//       props: { id: 'h2', class: { foo: true, bar: false } },
//       children: "渲染测试"
//     },
//     {
//       type: 'button',
//       props: {
//         id: 'btn',
//         class: ['haha heiehi', { six: true, seven: false, eight: true }],
//         disabled: false,
//         onClick: [
//           (e: Event) => {
//             console.log('btn click111', e);
//           },
//           (e: Event) => {
//             console.log('btn click222', e);
//           },
//         ],
//         onMouseDown: (e: Event) => {
//           console.log('btn mousedown', e);
//         }
//       },
//       children: '你好呀！👋'
//     }
//   ]

// }

// const vNode2: VNode = {
//   type: 'div',
//   props: {
//     id: 'container2',
//     class: 'container2'
//   },
//   children: [
//     {
//       type: 'h2',
//       props: { id: 'h22', class: { foo2: true, bar2: false } },
//       children: "渲染测试22"
//     },
//     {
//       type: 'button',
//       props: { id: 'btn2', class: ['haha2 heiehi2', { six2: true, seven2: false, eight2: true }], disabled: '' },
//       children: '你好呀222！👋'
//     },
//     {
//       type: 'main',
//       props: { id: 'main' },
//       children: [
//         {
//           type: Text,
//           props: { id: 'text' },
//           children: "下面有个注释和无序列表！！！"
//         },
//         {
//           type: Comment,
//           props: { id: 'comment' },
//           children: "这是一个注释...,下面是一个无序列表"
//         },
//         {
//           type: 'ul',
//           children: [
//             {
//               type: Fragment,
//               children: [
//                 { type: 'li', props: { class: 'li1' }, children: '列表一' },
//                 { type: 'li', props: { class: 'li2' }, children: '列表二' },
//                 { type: 'li', props: { class: 'li3' }, children: '列表三' },
//                 { type: 'li', props: { class: 'li4' }, children: '列表四' },
//                 { type: 'li', props: { class: 'li5' }, children: '列表五' },
//                 { type: 'li', props: { class: 'li6' }, children: '列表六' },
//               ]
//             }
//           ]
//         }

//       ]
//     }
//   ]

// }
// renderer.render(vNode, document.querySelector('#app')!)
// renderer.render(vNode2, document.querySelector('#app')!)

/**
 * 2.render响应式更新
 */
// const bol = ref(false)
// effect(() => {
//   // 创建 vnode
//   const vnode = {
//     type: 'div',
//     props: bol.value ? {
//       onClick: (e: Event) => {
//         console.log(e.timeStamp);
//         alert('父元素 clicked')
//       }
//     } : {},
//     children: [
//       {
//         type: 'p',
//         props: {
//           onClick: () => {
//             bol.value = true
//           }
//         },
//         children: 'text'
//       }
//     ]
//   }
//   // 渲染 vnode
//   renderer.render(vnode, document.querySelector('#app')!)
// })


/**
 * 3.简单diff
 */
const oldVNode = {
  type: 'div',
  children: [
    { type: 'p', children: '1', key: 1 },
    { type: 'p', children: '2', key: 2 },
    { type: 'p', children: 'hello', key: 3 }
  ]
}

const newVNode = {
  type: 'div',
  children: [
    { type: 'p', children: 'world', key: 3 },
    { type: 'p', children: '1', key: 1 },
    { type: 'p', children: '2', key: 2 }
  ]
}

// 首次挂载
renderer.render(oldVNode, document.querySelector('#app')!)
setTimeout(() => {
  // 1 秒钟后更新
  renderer.render(newVNode, document.querySelector('#app')!)
}, 3000);
