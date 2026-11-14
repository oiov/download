/// <reference types="vite/client" />

// Vite 的资源导入类型。
//
// `vite/client` 覆盖常见图片类型，但**不覆盖 `?raw`**。以文本方式导入资源时
// 缺这个声明，`tsc --noEmit` 会把它们判成找不到模块，而 `vite build` 本身能过。
declare module '*?raw' {
  const content: string
  export default content
}

declare module '*.md?raw' {
  const content: string
  export default content
}
