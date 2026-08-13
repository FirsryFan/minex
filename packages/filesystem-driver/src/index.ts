import type { DriverContext } from "@minex/kernel";
import { createBrowserFileSystem } from "./fs.js";

/**
 * 文件系统驱动：贡献 filesystem 能力（readDir/readFile/writeFile）+ 侧边栏文件树 + 工作区。
 * 所有文件操作限制在用户选定的根目录内（路径安全见 path.ts）。
 */
export default {
  async activate(ctx: DriverContext) {
    const fs = createBrowserFileSystem();

    // 核心能力：供 markdown / agent 等驱动复用
    ctx.register("filesystem", "default", fs);

    // 侧边栏贡献（文件树常驻左栏）
    ctx.register("sidebar", "minex.filesystem", {
      load: () => import("./sidebar-view.js"),
    });

    // 工作区贡献
    ctx.register("workspace", "minex.filesystem", {
      load: () => import("./workspace-view.js"),
    });

    return () => {};
  },
};
