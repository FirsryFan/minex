/**
 * 浏览器 stub（Rollup 会把 `fs.existsSync` 提升为具名导入，所以必须导出同名函数）。
 * 浏览器宿主用内存存储 + 直接注册插件，永不会调用这里；若意外调用，抛清晰错误。
 */
function unsupported(name: string): never {
  throw new Error(`[browser] node:fs.${name} 不可用——浏览器宿主不使用文件存储`);
}

export const existsSync = () => unsupported("existsSync");
export const readFileSync = () => unsupported("readFileSync");
export const writeFileSync = () => unsupported("writeFileSync");
export const mkdirSync = () => unsupported("mkdirSync");
export const renameSync = () => unsupported("renameSync");
export const readdirSync = () => unsupported("readdirSync");
export const rmSync = () => unsupported("rmSync");
export const cpSync = () => unsupported("cpSync");
export const copyFileSync = () => unsupported("copyFileSync");
