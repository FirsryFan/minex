/** 浏览器 stub（见 fs.ts）。 */
function unsupported(name: string): never {
  throw new Error(`[browser] node:url.${name} 不可用`);
}

export const pathToFileURL = () => unsupported("pathToFileURL");
export const fileURLToPath = () => unsupported("fileURLToPath");
