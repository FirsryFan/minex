// Vite 的 ?raw 导入：README.md 作为字符串
declare module "*?raw" {
  const content: string;
  export default content;
}
