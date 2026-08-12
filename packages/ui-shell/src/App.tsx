import { useEffect, useState } from "react";
import { FloatingWindow } from "./components/FloatingWindow.js";
import { MainArea } from "./components/MainArea.js";
import { RightBar } from "./components/RightBar.js";
import { SettingsForm } from "./components/SettingsForm.js";
import { Sidebar } from "./components/Sidebar.js";
import { TopBar } from "./components/TopBar.js";
import { useKernel } from "./kernel-context.js";

export function App({ problems }: { problems: string[] }) {
  const kernel = useKernel();
  const [collapsed, setCollapsed] = useState({ left: false, right: false });
  const [selectedPanelId, setSelectedPanelId] = useState<string | null>(null);
  const [commandResult, setCommandResult] = useState<string | null>(null);
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
      <TopBar pluginCount={kernel.plugins.list().length} onOpenSettings={() => setSettingsOpen(true)} />
      <Sidebar
        selectedPanelId={selectedPanelId}
        onSelect={(id) => setSelectedPanelId(id)}
        problems={problems}
      />
      <MainArea
        collapsed={collapsed}
        onToggleLeft={() => setCollapsed((c) => ({ ...c, left: !c.left }))}
        onToggleRight={() => setCollapsed((c) => ({ ...c, right: !c.right }))}
        selectedPanelId={selectedPanelId}
        commandResult={commandResult}
      />
      <RightBar onRun={setCommandResult} />
      {settingsOpen && (
        <FloatingWindow title="插件设置" onClose={() => setSettingsOpen(false)}>
          <SettingsForm />
        </FloatingWindow>
      )}
    </div>
  );
}
