import type { ComponentType } from "react";

/** 面板停靠位置：left/right 侧栏、main 主区、floating 浮窗 */
export type PanelDock = "left" | "right" | "main" | "floating";

/**
 * 驱动贡献的面板（S3 面板化：替代旧 sidebar/workspace 概念）。
 * 面板 = 内容 + 默认停靠位；外壳决定布局（停靠 / 浮起 / 多开）。
 * 驱动经 `ctx.register("panel", id, PanelContribution)` 贡献。
 */
export interface PanelContribution {
  /** 所属驱动 id（主区按活动驱动匹配） */
  driverId: string;
  /** 面板唯一 id（驱动命名空间，如 "minex.filesystem.sidebar"） */
  id: string;
  title: string;
  icon?: string;
  defaultDock: PanelDock;
  load: () => Promise<{ default: ComponentType<{ kernel: unknown }> }>;
}

/** 从内核注册表收集面板贡献（宿主视图：registry.query 返回 Contribution[]，需 .map(c => c.value)）。 */
export function queryPanels(kernel: {
  registry: {
    query: <T>(type: string) => Array<{ value: T }>;
  };
}): PanelContribution[] {
  return kernel.registry.query<PanelContribution>("panel").map((c) => c.value);
}
