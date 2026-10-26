/** Vite 的 ?url 导入在浏览器分支使用，Node 分支不会执行。 */
declare module '*?url' {
  const url: string;
  export default url;
}
