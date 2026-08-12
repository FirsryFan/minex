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
  onOpenSettings,
}: {
  drivers: DriverOption[];
  activeDriverId: string | null;
  onSelectDriver: (id: string) => void;
  onOpenSettings: () => void;
}) {
  const active = drivers.find((d) => d.id === activeDriverId);

  return (
    <header className="topbar">
      <DriverSelector drivers={drivers} activeDriverId={activeDriverId} onSelect={onSelectDriver} />
      {active && (
        <span className="topbar-active-driver">
          <span className="driver-icon">{active.icon ?? "📦"}</span>
          <span>{active.name}</span>
        </span>
      )}
      <span style={{ flex: 1 }} />
      <ThemeToggle />
      <button className="btn-ghost" onClick={onOpenSettings}>
        设置
      </button>
    </header>
  );
}
