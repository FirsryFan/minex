// Vite 的 ?raw 与 CSS 导入声明
declare module "*?raw" {
  const content: string;
  export default content;
}
declare module "*.css" {
  const content: string;
  export default content;
}
