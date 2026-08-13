// Vite 的 ?raw 导入：README.md 作为字符串（Vite 构建时处理，tsc 仅需此声明）
declare module "*?raw" {
  const content: string;
  export default content;
}
