import { PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen, Settings } from "lucide-react";
import { DriverIcon } from "./DriverIcon.js";
import { DriverSelector } from "./DriverSelector.js";
import { ThemeToggle } from "./ThemeToggle.js";

interface DriverOption {
  id: string;
  name: string;
  icon?: string;
}

/**
 * 顶栏（外壳固定）：左 = 驱动选择器 + 当前驱动；右 = 深浅切换 + 设置。
 * 命令面板（/ 指令）留待后续。
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
      <button className="icon-btn" title="设置" onClick={onOpenSettings}>
        <Settings size={15} />
      </button>
    </header>
  );
}
