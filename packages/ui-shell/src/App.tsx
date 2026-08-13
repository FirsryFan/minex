import React, { Suspense, lazy, useEffect, useMemo, useState } from "react";
import type { ComponentType } from "react";
import { FloatingPanel } from "./components/FloatingPanel.js";
import { SettingsPage } from "./components/SettingsPage.js";
import { ThemeManager } from "./components/ThemeManager.js";
import { TopBar } from "./components/TopBar.js";
import { useKernel } from "./kernel-context.js";
import { queryPanels, type PanelContribution } from "./panels.js";

const ACTIVE_DRIVER_KEY = "minex.activeDriver";
const THEME_KEY = "minex.theme";

interface FloatingState {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * 外壳（S3 面板化）：驱动贡献「面板」（内容 + 默认停靠位），外壳渲染停靠面板（左/右/主区）+ 浮窗。
 * - 左栏：defaultDock "left" 的面板（tab 切换，双击 tab 浮起）
 * - 主区：活动驱动的 defaultDock "main" 面板（无则留空）
 * - 右栏：defaultDock "right" 的面板
 * - 浮窗层：defaultDock "floating" 或用户浮起的面板（FloatingPanel 拖拽/缩放/关闭回停靠）
 * 工作视图多开（多实例切换）留待后续阶段。
 */
export function App({ problems }: { problems: string[] }) {
  const kernel = useKernel();
  const [view, setView] = useState<"workspace" | "settings">("workspace");
  const [activeDriverId, setActiveDriverId] = useState<string | null>(() =>
    typeof localStorage !== "undefined" ? localStorage.getItem(ACTIVE_DRIVER_KEY) : null,
  );
  const [collapsed, setCollapsed] = useState({ left: false, right: false });
  const [widths, setWidths] = useState({ left: 220, right: 220 });
  const [dark, setDark] = useState<boolean>(() => {
    const saved = typeof localStorage !== "undefined" ? localStorage.getItem(THEME_KEY) : null;
    return saved ? saved === "dark" : false; // 默认浅色
  });
  const [tick, setTick] = useState(0);
  const [activeLeftPanelId, setActiveLeftPanelId] = useState<string | null>(null);
  const [floating, setFloating] = useState<FloatingState[]>([]);
  const [hiddenPanels, setHiddenPanels] = useState<string[]>([]); // 默认浮窗（defaultDock:"floating"）关闭后永久隐藏

  // 事件驱动重渲染（驱动列表/状态/贡献变化）
  useEffect(() => {
    const offs: Array<() => void> = [];
    offs.push(kernel.registry.onChange("*", () => setTick((t) => t + 1)));
    offs.push(kernel.events.on("minex:dataChanged", () => setTick((t) => t + 1)));
    return () => offs.forEach((off) => off());
  }, [kernel]);

  // 文件树点击 markdown 文件 → 自动切换到 markdown 工作区（markdown workspace 随后订阅事件加载内容）
  useEffect(() => {
    return kernel.events.on("filesystem:openFile", () => {
      setActiveDriverId("minex.markdown");
      try {
        localStorage.setItem(ACTIVE_DRIVER_KEY, "minex.markdown");
      } catch {
        /* localStorage 不可用 */
      }
    });
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

  // 顶栏驱动选择器只列「已启用且有主界面」的驱动
  const drivers = kernel.drivers
    .list()
    .filter((m) => m.manifest.hasWorkspace && kernel.drivers.getState(m.manifest.id) === "activated")
    .map((m) => ({
      id: m.manifest.id,
      name: m.manifest.name,
      icon: m.manifest.icon,
    }));

  // 面板收集与分层（随注册表变化重查）
  const panels = useMemo<PanelContribution[]>(() => queryPanels(kernel), [kernel, tick]);
  const floatingIds = new Set(floating.map((f) => f.id));
  const floatingAll = panels.filter((p) => !hiddenPanels.includes(p.id) && (p.defaultDock === "floating" || floatingIds.has(p.id)));
  const docked = panels.filter((p) => p.defaultDock !== "floating" && !floatingIds.has(p.id));
  const leftPanels = docked.filter((p) => p.defaultDock === "left");
  const rightPanels = docked.filter((p) => p.defaultDock === "right");
  const mainPanel = docked.find((p) => p.defaultDock === "main" && p.driverId === activeDriverId);
  const leftPanel = leftPanels.find((p) => p.id === activeLeftPanelId) ?? leftPanels[0];

  // lazy 面板缓存（lazy 必须稳定，否则每次渲染重挂载）
  const panelLazy = useMemo(() => {
    const map = new Map<string, ComponentType<{ kernel: typeof kernel }>>();
    for (const p of panels) map.set(p.id, lazy(p.load) as ComponentType<{ kernel: typeof kernel }>);
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panels]);

  function floatPanel(id: string): void {
    setFloating((prev) => (prev.some((f) => f.id === id) ? prev : [...prev, { id, x: 140, y: 90, w: 360, h: 480 }]));
  }
  function dockPanel(id: string): void {
    // 默认浮窗（defaultDock:"floating"）关闭 = 永久隐藏；浮起的面板关闭 = 回 defaultDock（审查 m1）
    const p = panels.find((x) => x.id === id);
    if (p?.defaultDock === "floating") {
      setHiddenPanels((prev) => (prev.includes(id) ? prev : [...prev, id]));
    } else {
      setFloating((prev) => prev.filter((f) => f.id !== id));
    }
  }
  function patchFloating(id: string, patch: Partial<FloatingState>): void {
    setFloating((prev) =>
      prev.some((f) => f.id === id)
        ? prev.map((f) => (f.id === id ? { ...f, ...patch } : f))
        : [...prev, { id, x: 140, y: 90, w: 360, h: 480, ...patch }],
    );
  }

  function renderPanel(p: PanelContribution, fallback?: string): React.ReactNode {
    const Comp = panelLazy.get(p.id);
    if (!Comp) return null;
    return (
      <Suspense fallback={<div className="loading">{fallback ?? "加载面板…"}</div>}>
        <Comp kernel={kernel} />
      </Suspense>
    );
  }

  if (view === "settings") {
    return (
      <>
        <ThemeManager dark={dark} />
        <SettingsPage onBack={() => setView("workspace")} />
      </>
    );
  }

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
        collapsed={collapsed}
        onToggleLeft={() => setCollapsed((c) => ({ ...c, left: !c.left }))}
        onToggleRight={() => setCollapsed((c) => ({ ...c, right: !c.right }))}
      />
      <div className="workspace">
        {/* 左侧栏：停靠面板（tab 切换；双击 tab 浮起） */}
        <div
          className={`sidebar${collapsed.left ? " collapsed" : ""}`}
          style={{ width: collapsed.left ? undefined : widths.left }}
        >
          {leftPanels.length > 0 && (
            <div className="panel-tabs">
              {leftPanels.map((p) => (
                <button
                  key={p.id}
                  className={`panel-tab${leftPanel?.id === p.id ? " active" : ""}`}
                  onClick={() => setActiveLeftPanelId(p.id)}
                  onDoubleClick={() => floatPanel(p.id)}
                  title={`浮起「${p.title}」（双击）`}
                >
                  {p.title}
                </button>
              ))}
            </div>
          )}
          {leftPanel && <div className="dock-panel">{renderPanel(leftPanel)}</div>}
        </div>
        {!collapsed.left && (
          <Resizer side="left" initialWidth={widths.left} onResize={(t) => setWidths((w) => ({ ...w, left: clamp(t, 160, 480) }))} />
        )}

        {/* 主区：活动驱动的主面板 */}
        <div className="main">
          {mainPanel ? (
            renderPanel(mainPanel, "加载工作区…")
          ) : (
            /* 无活动/已启用驱动工作区时：主体留空，不显示任何占位文字 */
            <div className="main-empty" />
          )}
        </div>

        {!collapsed.right && (
          <Resizer side="right" initialWidth={widths.right} onResize={(t) => setWidths((w) => ({ ...w, right: clamp(t, 160, 480) }))} />
        )}

        {/* 右侧栏：停靠面板 */}
        <div
          className={`rightbar${collapsed.right ? " collapsed" : ""}`}
          style={{ width: collapsed.right ? undefined : widths.right }}
        >
          {rightPanels.length > 0 && (
            <div className="panel-tabs">
              {rightPanels.map((p) => (
                <button key={p.id} className="panel-tab active" onDoubleClick={() => floatPanel(p.id)} title={`浮起「${p.title}」（双击）`}>
                  {p.title}
                </button>
              ))}
            </div>
          )}
          {rightPanels.map((p) => (
            <div key={p.id} className="dock-panel">{renderPanel(p)}</div>
          ))}
        </div>
      </div>

      {/* 浮窗层 */}
      {floatingAll.map((p) => {
        const fs = floating.find((f) => f.id === p.id);
        return (
          <FloatingPanel
            key={p.id}
            title={p.title}
            x={fs?.x ?? 140}
            y={fs?.y ?? 90}
            w={fs?.w ?? 360}
            h={fs?.h ?? 480}
            onMove={(x, y) => patchFloating(p.id, { x, y })}
            onResize={(w, h) => patchFloating(p.id, { w, h })}
            onClose={() => dockPanel(p.id)}
          >
            {renderPanel(p)}
          </FloatingPanel>
        );
      })}
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
