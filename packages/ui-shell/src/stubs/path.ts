/** 浏览器 stub（见 fs.ts）。 */
function unsupported(name: string): never {
  throw new Error(`[browser] node:path.${name} 不可用`);
}

export const join = () => unsupported("join");
export const resolve = () => unsupported("resolve");
export const dirname = () => unsupported("dirname");
export const basename = () => unsupported("basename");
export const extname = () => unsupported("extname");
