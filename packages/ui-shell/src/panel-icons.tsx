import {
  FileText,
  FolderTree,
  LayoutGrid,
  MessageCircle,
  MessagesSquare,
  type LucideIcon,
} from "lucide-react";
import type { ComponentType } from "react";

/**
 * 左栏 icon 栏映射（task 2-R2，P2 拍板）：panelId → icon 组件（缺省 LayoutGrid）。
 * 3-5：类型放宽为 ComponentType<{size?}>——支持自定义 SVG（SessionTreeIcon，树形）。
 * 驱动不引 lucide（避免依赖），icon 映射由外壳维护。
 */
export function SessionTreeIcon({ size = 18 }: { size?: number | string }) {
  // 3-5 §一 树形 SVG（viewBox 24×24：菱形四角 (12,4)/(4,15)/(20,15)/(12,20) r2.5 实心
  // + 三条边 (12,4)→三叶，无闭合边 = 树形）
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <g stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <line x1="12" y1="4" x2="12" y2="12" />
        <line x1="12" y1="12" x2="4" y2="15" />
        <line x1="12" y1="12" x2="20" y2="15" />
      </g>
      <g fill="currentColor">
        <circle cx="12" cy="4" r="2.5" />
        <circle cx="4" cy="15" r="2.5" />
        <circle cx="20" cy="15" r="2.5" />
        <circle cx="12" cy="20" r="2.5" />
      </g>
    </svg>
  );
}

export const PANEL_ICONS: Record<string, ComponentType<{ size?: number | string }>> = {
  "minex.filesystem.sidebar": FolderTree,
  "mist.session.overview": MessagesSquare,
  "minex.agent.chat": MessageCircle,
  "minex.markdown.workspace": FileText,
  "minex.graph.view": SessionTreeIcon, // 3-5：通用图谱面板 → 树形 icon（原 mist.session.graph 已迁移）
};

/** 取面板 icon（未映射 → LayoutGrid 缺省） */
export function panelIcon(panelId: string): ComponentType<{ size?: number | string }> {
  return PANEL_ICONS[panelId] ?? LayoutGrid;
}
