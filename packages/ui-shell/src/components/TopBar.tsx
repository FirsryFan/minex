import { PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen, Settings } from "lucide-react";
import { DriverIcon } from "./DriverIcon.js";
import { DriverSelector } from "./DriverSelector.js";
import { ThemeToggle } from "./ThemeToggle.js";

interface DriverOption {
  id: string;
  name: string;
  icon?: string;
}

/** Windows 任务视图风格图标：两个部分重合的矩形（一虚一实） */
function TaskViewIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="14" height="14" rx="2" strokeDasharray="3 3" opacity="0.6" />
      <rect x="8" y="8" width="13" height="13" rx="2" />
    </svg>
  );
}

/**
 * 顶栏（外壳固定）：左 = 驱动选择器 + 当前驱动；右 = 折叠 + 深浅切换 + 任务视图 + 设置。
 * 任务视图按钮（S4）：打开 Windows 任务视图风格的工作区切换浮窗。
 */
export function TopBar({
  drivers,
  activeDriverId,
  onSelectDriver,
  dark,
  onToggleTheme,
  onOpenSettings,
  collapsed,
  onToggleLeft,
  onToggleRight,
  onOpenTaskView,
  taskViewActive,
}: {
  drivers: DriverOption[];
  activeDriverId: string | null;
  onSelectDriver: (id: string) => void;
  dark: boolean;
  onToggleTheme: () => void;
  onOpenSettings: () => void;
  collapsed: { left: boolean; right: boolean };
  onToggleLeft: () => void;
  onToggleRight: () => void;
  onOpenTaskView: () => void;
  taskViewActive: boolean;
}) {
  const active = drivers.find((d) => d.id === activeDriverId);

  return (
    <header className="topbar">
      <DriverSelector drivers={drivers} activeDriverId={activeDriverId} onSelect={onSelectDriver} />
      {active && (
        <span className="topbar-active-driver">
          <DriverIcon icon={active.icon} />
          <span>{active.name}</span>
        </span>
      )}
      <span style={{ flex: 1 }} />
      {/* 折叠按钮常驻顶栏（驱动工作区存在时 MainArea 不渲染，折叠入口不能只放在 MainArea） */}
      <button className="icon-btn" title={collapsed.left ? "展开左栏" : "折叠左栏"} onClick={onToggleLeft}>
        {collapsed.left ? <PanelLeftOpen size={15} /> : <PanelLeftClose size={15} />}
      </button>
      <button className="icon-btn" title={collapsed.right ? "展开右栏" : "折叠右栏"} onClick={onToggleRight}>
        {collapsed.right ? <PanelRightOpen size={15} /> : <PanelRightClose size={15} />}
      </button>
      <ThemeToggle dark={dark} onToggle={onToggleTheme} />
      <button className={`icon-btn taskview-btn${taskViewActive ? " active" : ""}`} title="任务视图（切换工作区）" onClick={onOpenTaskView}>
        <TaskViewIcon />
      </button>
      <button className="icon-btn" title="设置" onClick={onOpenSettings}>
        <Settings size={15} />
      </button>
    </header>
  );
}
