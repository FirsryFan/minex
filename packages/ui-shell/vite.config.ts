import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";

/**
 * 浏览器宿主不用文件存储/目录加载（那是 Node 宿主 CLI/Electron 主进程的事）。
 * @minex/kernel 的 index 会 re-export loader/storage（依赖 node:fs/path/url），
 * 浏览器打包时把这些 node: 内建 stub 成空模块——浏览器路径永远不会调用它们。
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "node:fs": fileURLToPath(new URL("./src/stubs/fs.ts", import.meta.url)),
      "node:path": fileURLToPath(new URL("./src/stubs/path.ts", import.meta.url)),
      "node:url": fileURLToPath(new URL("./src/stubs/url.ts", import.meta.url)),
    },
  },
  server: {
    port: 5173,
  },
});
