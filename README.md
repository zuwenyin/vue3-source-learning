# Vue 3 源码学习

这是一个用于学习 Vue 3 核心实现思路的个人练习项目，通过 TypeScript 编写小型示例，逐步理解响应式系统及相关机制。项目中的实现用于学习和实验，并非 Vue 官方源码或可直接用于生产环境的实现。

## 当前内容

- `packages/reactivity`：响应式系统实验，包含基于 `Proxy` 的数据拦截、依赖收集与触发、副作用函数、嵌套 effect、调度器、计算属性和侦听器等练习。
- `packages/logger`：控制台日志工具，为示例提供带样式的日志输出，也包含浏览器预览页面。

## 环境要求

- Node.js
- pnpm（项目指定版本：`pnpm@12.10.1`）

## 开始使用

在项目根目录安装依赖并进行类型检查：

```bash
pnpm install
pnpm typecheck
```

监听 TypeScript 文件并生成 JavaScript 编译产物：

```bash
pnpm dev:effect
```

## 浏览器示例

项目示例通过浏览器原生 ES Modules 加载编译后的 JavaScript。先运行 `pnpm dev:effect`，再通过本地静态 HTTP 服务器打开对应页面：

- 响应式示例：`packages/reactivity/index.html`
- 日志预览：`packages/logger/index.html`

不要直接用 `file://` 打开页面；浏览器模块加载和 import map 需要通过 HTTP 服务访问。响应式页面使用 import map 将 `@vue3-learn/logger` 映射到本地 logger 编译产物。

## 项目结构

```text
.
├── packages/
│   ├── logger/       # 日志工具及浏览器预览页
│   └── reactivity/   # Vue 3 响应式机制学习示例
├── package.json
├── pnpm-workspace.yaml
└── tsconfig.json
```

## 学习说明

建议从 `packages/reactivity/effect.ts` 中的依赖收集与触发逻辑开始阅读，并结合页面中的实验代码观察数据变化如何驱动副作用重新执行。随着学习推进，可以在此基础上继续补充其他 Vue 3 核心模块的实现与笔记。
