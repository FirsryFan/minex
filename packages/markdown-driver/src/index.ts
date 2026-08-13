import type { DriverContext } from "@minex/kernel";
import { renderMarkdown } from "./markdown.js";

/**
 * Markdown 编辑器驱动：贡献三样能力。
 * 1. markdown.render —— 通用 markdown→HTML 渲染（供 README 等其他位置复用）
 * 2. workspace —— 工作区视图（编辑/预览/分屏三模式）
 * 3. settingsView —— 编辑器设置
 * 均惰性加载 React 组件（Node 宿主不触发）。
 */
export default {
  async activate(ctx: DriverContext) {
    // 通用 markdown 渲染能力（纯函数，任何驱动可复用）
    ctx.register("markdown", "render", { render: renderMarkdown });

    // 工作区视图（惰性）
    ctx.register("workspace", "minex.markdown", {
      load: () => import("./workspace-view.js"),
    });

    // 设置视图（惰性）
    ctx.register("settingsView", "minex.markdown", {
      load: () => import("./settings-view.js"),
    });

    return () => {};
  },
};
