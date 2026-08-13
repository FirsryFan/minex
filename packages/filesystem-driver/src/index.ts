import type { DriverContext } from "@minex/kernel";
import { createBrowserFileSystem } from "./fs.js";

/**
 * 文件系统驱动：贡献 filesystem 能力 + 两个面板（文件树常驻左栏、工作区主区）。
 * 所有文件操作限制在用户选定的根目录内（路径安全见 path.ts）。
 */
export default {
  async activate(ctx: DriverContext) {
    const fs = createBrowserFileSystem();

    // 核心能力：供 markdown / agent / session 等驱动复用
    ctx.register("filesystem", "default", fs);

    // 面板：文件树（左栏常驻；双击 tab 可浮起）
    ctx.register("panel", "minex.filesystem.sidebar", {
      driverId: "minex.filesystem",
      id: "minex.filesystem.sidebar",
      title: "文件",
      defaultDock: "left",
      load: () => import("./sidebar-view.js"),
    });

    // 面板：文件系统工作区（主区，活动驱动为 filesystem 时显示）
    ctx.register("panel", "minex.filesystem.workspace", {
      driverId: "minex.filesystem",
      id: "minex.filesystem.workspace",
      title: "文件系统",
      defaultDock: "main",
      load: () => import("./workspace-view.js"),
    });

    return () => {};
  },
};
