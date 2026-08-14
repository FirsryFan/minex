import {
  FileText,
  FolderTree,
  LayoutGrid,
  MessageCircle,
  MessagesSquare,
  Network,
  type LucideIcon,
} from "lucide-react";

/**
 * 左栏 icon 栏映射（task 2-R2，P2 拍板）：panelId → lucide icon（缺省 LayoutGrid）。
 * 驱动不引 lucide（避免依赖），icon 映射由外壳维护——驱动声明的 manifest.icon（图片）暂不用于 icon 栏。
 */
export const PANEL_ICONS: Record<string, LucideIcon> = {
  "minex.filesystem.sidebar": FolderTree,
  "mist.session.overview": MessagesSquare,
  "mist.session.graph": Network,
  "minex.agent.chat": MessageCircle,
  "minex.markdown.workspace": FileText,
};

/** 取面板 icon（未映射 → LayoutGrid 缺省） */
export function panelIcon(panelId: string): LucideIcon {
  return PANEL_ICONS[panelId] ?? LayoutGrid;
}
