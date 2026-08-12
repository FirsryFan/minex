import { useEffect, useState } from "react";
import { FloatingWindow } from "./components/FloatingWindow.js";
import { MainArea } from "./components/MainArea.js";
import { RightBar } from "./components/RightBar.js";
import { SettingsForm } from "./components/SettingsForm.js";
import { Sidebar } from "./components/Sidebar.js";
import { TopBar } from "./components/TopBar.js";
import { useKernel } from "./kernel-context.js";

/**
 * 通用外壳（非驱动内容）：
 * 布局 + 槽位（Sidebar 列出驱动的 ui 贡献）+ schema 设置表单。
 * 具体视图（画布 / 命令面板 / 面板内容）属于驱动，不在外壳内实现。
 */
export function App({ problems }: { problems: string[] }) {
  const kernel = useKernel();
  const [collapsed, setCollapsed] = useState({ left: false, right: false });
  const [selectedPanelId, setSelectedPanelId] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [, setTick] = useState(0); // 事件驱动重渲染

  // 订阅注册表变更 + data:changed，触发重查询（简单版响应式，无状态管理库）
  useEffect(() => {
    const offs: Array<() => void> = [];
    offs.push(kernel.registry.onChange("*", () => setTick((t) => t + 1)));
    offs.push(kernel.events.on("minex:dataChanged", () => setTick((t) => t + 1)));
    return () => offs.forEach((off) => off());
  }, [kernel]);

  const shellClass = `shell${collapsed.left ? " left-collapsed" : ""}${collapsed.right ? " right-collapsed" : ""}`;

  return (
    <div className={shellClass}>
      <TopBar driverCount={kernel.drivers.list().length} onOpenSettings={() => setSettingsOpen(true)} />
      <Sidebar
        selectedPanelId={selectedPanelId}
        onSelect={setSelectedPanelId}
        problems={problems}
      />
      <MainArea
        collapsed={collapsed}
        onToggleLeft={() => setCollapsed((c) => ({ ...c, left: !c.left }))}
        onToggleRight={() => setCollapsed((c) => ({ ...c, right: !c.right }))}
        selectedPanelId={selectedPanelId}
      />
      <RightBar />
      {settingsOpen && (
        <FloatingWindow title="驱动设置" onClose={() => setSettingsOpen(false)}>
          <SettingsForm />
        </FloatingWindow>
      )}
    </div>
  );
}
