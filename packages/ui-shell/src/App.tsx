import { useEffect, useState } from "react";
import { MainArea } from "./components/MainArea.js";
import { RightBar } from "./components/RightBar.js";
import { SettingsPage } from "./components/SettingsPage.js";
import { Sidebar } from "./components/Sidebar.js";
import { ThemeManager } from "./components/ThemeManager.js";
import { TopBar } from "./components/TopBar.js";
import { useKernel } from "./kernel-context.js";

const ACTIVE_DRIVER_KEY = "minex.activeDriver";
const THEME_KEY = "minex.theme";

/**
 * 外壳：view = workspace（顶栏 + 工作区）| settings（全屏设置页）。
 * 活动驱动决定工作区内容（v1 为默认通用结构；驱动工作区贡献留待后续）。
 */
export function App({ problems }: { problems: string[] }) {
  const kernel = useKernel();
  const [view, setView] = useState<"workspace" | "settings">("workspace");
  const [activeDriverId, setActiveDriverId] = useState<string | null>(() =>
    typeof localStorage !== "undefined" ? localStorage.getItem(ACTIVE_DRIVER_KEY) : null,
  );
  const [collapsed, setCollapsed] = useState({ left: false, right: false });
  const [selectedPanelId, setSelectedPanelId] = useState<string | null>(null);
  const [dark, setDark] = useState<boolean>(() => {
    const saved = typeof localStorage !== "undefined" ? localStorage.getItem(THEME_KEY) : null;
    return saved ? saved === "dark" : false; // 默认浅色
  });
  const [, setTick] = useState(0);

  // 事件驱动重渲染（驱动列表/状态/贡献变化）
  useEffect(() => {
    const offs: Array<() => void> = [];
    offs.push(kernel.registry.onChange("*", () => setTick((t) => t + 1)));
    offs.push(kernel.events.on("minex:dataChanged", () => setTick((t) => t + 1)));
    return () => offs.forEach((off) => off());
  }, [kernel]);

  // 主题：应用 data-theme + 持久化（ThemeManager 消费驱动 theme 贡献）
  useEffect(() => {
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    try {
      localStorage.setItem(THEME_KEY, dark ? "dark" : "light");
    } catch {
      /* localStorage 不可用 */
    }
  }, [dark]);

  function selectDriver(id: string): void {
    setActiveDriverId(id);
    try {
      localStorage.setItem(ACTIVE_DRIVER_KEY, id);
    } catch {
      /* 忽略 localStorage 不可用 */
    }
  }

  if (view === "settings") {
    return <SettingsPage onBack={() => setView("workspace")} />;
  }

  const drivers = kernel.drivers.list().map((m) => ({
    id: m.manifest.id,
    name: m.manifest.name,
    icon: m.manifest.icon,
  }));

  const shellClass = `shell${collapsed.left ? " left-collapsed" : ""}${collapsed.right ? " right-collapsed" : ""}`;

  return (
    <div className={shellClass}>
      <ThemeManager dark={dark} />
      <TopBar
        drivers={drivers}
        activeDriverId={activeDriverId}
        onSelectDriver={selectDriver}
        dark={dark}
        onToggleTheme={() => setDark((d) => !d)}
        onOpenSettings={() => setView("settings")}
      />
      <Sidebar selectedPanelId={selectedPanelId} onSelect={setSelectedPanelId} problems={problems} />
      <MainArea
        collapsed={collapsed}
        onToggleLeft={() => setCollapsed((c) => ({ ...c, left: !c.left }))}
        onToggleRight={() => setCollapsed((c) => ({ ...c, right: !c.right }))}
        selectedPanelId={selectedPanelId}
      />
      <RightBar />
    </div>
  );
}
