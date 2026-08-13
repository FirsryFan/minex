import React, { Suspense, lazy, useEffect, useMemo, useState } from "react";
import type { ComponentType } from "react";
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
  // 左右栏宽度（可拖拽调整，受最小宽度约束）；collapsed 时由 CSS 收缩为窄条
  const [widths, setWidths] = useState({ left: 220, right: 220 });
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

  // 顶栏驱动选择器只列有主界面的驱动（hasWorkspace）；纯设置驱动（外观/hello）不出现
  const drivers = kernel.drivers
    .list()
    .filter((m) => m.manifest.hasWorkspace)
    .map((m) => ({
      id: m.manifest.id,
      name: m.manifest.name,
      icon: m.manifest.icon,
    }));

  if (view === "settings") {
    // T1：ThemeManager 常驻（两种视图都挂载），设置页改主题即时生效
    return (
      <>
        <ThemeManager dark={dark} />
        <SettingsPage onBack={() => setView("workspace")} />
      </>
    );
  }

  // 活动驱动的工作区贡献（有则渲染驱动工作区，否则默认布局）
  const workspaceView = activeDriverId
    ? kernel.registry.get<{ load: () => Promise<{ default: ComponentType<{ kernel: typeof kernel }> }> }>("workspace", activeDriverId)
    : undefined;
  const WorkspaceView = useMemo(() => (workspaceView ? lazy(workspaceView.value.load) : null), [workspaceView, activeDriverId]);

  return (
    <div className="shell">
      <ThemeManager dark={dark} />
      <TopBar
        drivers={drivers}
        activeDriverId={activeDriverId}
        onSelectDriver={selectDriver}
        dark={dark}
        onToggleTheme={() => setDark((d) => !d)}
        onOpenSettings={() => setView("settings")}
      />
      {WorkspaceView ? (
        <div className="workspace">
          <Suspense fallback={<div className="loading">加载工作区…</div>}>
            <WorkspaceView kernel={kernel} />
          </Suspense>
        </div>
      ) : (
      <div className="workspace">
        <div
          className={`sidebar${collapsed.left ? " collapsed" : ""}`}
          style={{ width: collapsed.left ? undefined : widths.left }}
        >
          <Sidebar
            selectedPanelId={selectedPanelId}
            onSelect={(id) => setSelectedPanelId(id === selectedPanelId ? null : id)}
            problems={problems}
          />
        </div>
        {!collapsed.left && (
          <Resizer
            side="left"
            initialWidth={widths.left}
            onResize={(target) => setWidths((w) => ({ ...w, left: clamp(target, 160, 480) }))}
          />
        )}
        <MainArea
          collapsed={collapsed}
          onToggleLeft={() => setCollapsed((c) => ({ ...c, left: !c.left }))}
          onToggleRight={() => setCollapsed((c) => ({ ...c, right: !c.right }))}
          selectedPanelId={selectedPanelId}
        />
        {!collapsed.right && (
          <Resizer
            side="right"
            initialWidth={widths.right}
            onResize={(target) => setWidths((w) => ({ ...w, right: clamp(target, 160, 480) }))}
          />
        )}
        <div
          className={`rightbar${collapsed.right ? " collapsed" : ""}`}
          style={{ width: collapsed.right ? undefined : widths.right }}
        >
          <RightBar />
        </div>
      </div>
      )}
    </div>
  );
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

/** 可拖拽分隔条：左右栏宽度的拖拽把手。W5：window blur 兜底 + 卸载清理 */
function Resizer({
  side,
  initialWidth,
  onResize,
}: {
  side: "left" | "right";
  initialWidth: number;
  onResize: (targetWidth: number) => void;
}) {
  const cleanupRef = React.useRef<(() => void) | null>(null);

  function onMouseDown(e: React.MouseEvent): void {
    e.preventDefault();
    const startX = e.clientX;
    const base = initialWidth; // 修复1：以按下时宽度为基准，避免累计位移叠加放大
    // 左栏向右拖增宽（+dx）；右栏向左拖增宽（-dx）
    const dir = side === "left" ? 1 : -1;
    const move = (ev: MouseEvent) => onResize(base + dir * (ev.clientX - startX));
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      window.removeEventListener("blur", up); // 窗口失焦视为释放
      cleanupRef.current = null;
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    window.addEventListener("blur", up);
    cleanupRef.current = up;
  }

  // 组件卸载（如折叠时 Resizer 卸载）：强制清理拖拽状态
  React.useEffect(() => () => cleanupRef.current?.(), []);

  return <div className={`resizer resizer-${side}`} onMouseDown={onMouseDown} />;
}
