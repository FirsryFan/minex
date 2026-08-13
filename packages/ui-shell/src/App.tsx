import React, { Suspense, lazy, useEffect, useMemo, useState } from "react";
import type { ComponentType } from "react";
import { GripVertical } from "lucide-react";
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

/** 一个工作视图（S4 多开实例）的全部布局状态：活动驱动 + 栏宽折叠 + 面板 + 浮窗 */
interface InstanceState {
  id: number;
  name: string;
  activeDriverId: string | null;
  collapsed: { left: boolean; right: boolean };
  widths: { left: number; right: number };
  activeLeftPanelId: string | null;
  floating: FloatingState[];
  hiddenPanels: string[];
}

function makeInstance(id: number, name: string): InstanceState {
  return {
    id,
    name,
    activeDriverId: typeof localStorage !== "undefined" ? localStorage.getItem(ACTIVE_DRIVER_KEY) : null,
    collapsed: { left: false, right: false },
    widths: { left: 220, right: 220 },
    activeLeftPanelId: null,
    floating: [],
    hiddenPanels: [],
  };
}

/**
 * 外壳（S3 面板化 + S4 多开）：驱动贡献「面板」，外壳渲染停靠面板（左/右/主区）+ 浮窗层。
 * - 工作视图多开：每个实例独立布局状态（活动驱动/折叠/宽度/浮窗），顶部 view-strip 切换/新建/关闭
 * - 面板浮起（双击 dock tab）、贴靠 dock（拖到边缘回停靠）、浮窗拖拽/缩放
 */
export function App({ problems }: { problems: string[] }) {
  void problems; // 保留 bootstrap 签名；默认 Sidebar 已由面板化取代
  const kernel = useKernel();
  const [view, setView] = useState<"workspace" | "settings">("workspace");
  const [dark, setDark] = useState<boolean>(() => {
    const saved = typeof localStorage !== "undefined" ? localStorage.getItem(THEME_KEY) : null;
    return saved ? saved === "dark" : false;
  });
  const [instances, setInstances] = useState<InstanceState[]>(() => [makeInstance(1, "工作区 1")]);
  const [activeInstanceId, setActiveInstanceId] = useState(1);
  const activeInstance = instances.find((i) => i.id === activeInstanceId) ?? instances[0];

  // 主题：应用 data-theme + 持久化
  useEffect(() => {
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    try {
      localStorage.setItem(THEME_KEY, dark ? "dark" : "light");
    } catch {
      /* localStorage 不可用 */
    }
  }, [dark]);

  // 文件树点击 markdown 文件 → 当前工作视图切到 markdown 工作区
  useEffect(() => {
    return kernel.events.on("filesystem:openFile", () => {
      updateInstance(activeInstanceId, { activeDriverId: "minex.markdown" });
      try {
        localStorage.setItem(ACTIVE_DRIVER_KEY, "minex.markdown");
      } catch {
        /* localStorage 不可用 */
      }
    });
  }, [kernel, activeInstanceId]);

  function updateInstance(id: number, patch: Partial<InstanceState>): void {
    setInstances((prev) => prev.map((i) => (i.id === id ? { ...i, ...patch } : i)));
  }
  function addInstance(): void {
    const nextId = Math.max(0, ...instances.map((i) => i.id)) + 1;
    setInstances((prev) => [...prev, makeInstance(nextId, `工作区 ${prev.length + 1}`)]);
    setActiveInstanceId(nextId);
  }
  function closeInstance(id: number): void {
    if (instances.length <= 1) return;
    const rest = instances.filter((i) => i.id !== id);
    setInstances(rest);
    if (activeInstanceId === id) setActiveInstanceId(rest[rest.length - 1].id);
  }
  function selectDriver(id: string): void {
    updateInstance(activeInstanceId, { activeDriverId: id });
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
        activeDriverId={activeInstance.activeDriverId}
        onSelectDriver={selectDriver}
        dark={dark}
        onToggleTheme={() => setDark((d) => !d)}
        onOpenSettings={() => setView("settings")}
        collapsed={activeInstance.collapsed}
        onToggleLeft={() => updateInstance(activeInstanceId, { collapsed: { ...activeInstance.collapsed, left: !activeInstance.collapsed.left } })}
        onToggleRight={() => updateInstance(activeInstanceId, { collapsed: { ...activeInstance.collapsed, right: !activeInstance.collapsed.right } })}
      />
      {/* 工作视图条（S4 多开：切换 / 新建 / 关闭） */}
      <div className="view-strip">
        {instances.map((i) => (
          <span
            key={i.id}
            className={`view-tab${i.id === activeInstanceId ? " active" : ""}`}
            onClick={() => setActiveInstanceId(i.id)}
          >
            {i.name}
            {instances.length > 1 && (
              <button className="view-tab-close" title="关闭工作视图" onClick={(e) => { e.stopPropagation(); closeInstance(i.id); }}>
                ×
              </button>
            )}
          </span>
        ))}
        <button className="view-add" title="新建工作视图" onClick={addInstance}>＋</button>
      </div>
      <WorkspaceInstance
        key={activeInstanceId}
        kernel={kernel}
        instance={activeInstance}
        onUpdate={(patch) => updateInstance(activeInstanceId, patch)}
      />
    </div>
  );
}

/** 一个工作视图实例：渲染停靠面板（左/右/主区）+ 浮窗层（布局状态在 instance，S4 多开） */
function WorkspaceInstance({
  kernel,
  instance,
  onUpdate,
}: {
  kernel: ReturnType<typeof useKernel>;
  instance: InstanceState;
  onUpdate: (patch: Partial<InstanceState>) => void;
}) {
  const [tick, setTick] = useState(0);
  const [snapTarget, setSnapTarget] = useState<"left" | "right" | "main" | null>(null);

  // 事件驱动重渲染（驱动列表/状态/贡献变化）
  useEffect(() => {
    const offs: Array<() => void> = [];
    offs.push(kernel.registry.onChange("*", () => setTick((t) => t + 1)));
    offs.push(kernel.events.on("minex:dataChanged", () => setTick((t) => t + 1)));
    return () => offs.forEach((off) => off());
  }, [kernel]);

  const panels = useMemo<PanelContribution[]>(() => queryPanels(kernel), [kernel, tick]);
  const floatingIds = new Set(instance.floating.map((f) => f.id));
  const floatingAll = panels.filter((p) => !instance.hiddenPanels.includes(p.id) && (p.defaultDock === "floating" || floatingIds.has(p.id)));
  const docked = panels.filter((p) => p.defaultDock !== "floating" && !floatingIds.has(p.id));
  const leftPanels = docked.filter((p) => p.defaultDock === "left");
  const rightPanels = docked.filter((p) => p.defaultDock === "right");
  const mainPanel = docked.find((p) => p.defaultDock === "main" && p.driverId === instance.activeDriverId);
  const leftPanel = leftPanels.find((p) => p.id === instance.activeLeftPanelId) ?? leftPanels[0];

  // lazy 面板缓存（lazy 必须稳定，否则每次渲染重挂载）
  const panelLazy = useMemo(() => {
    const map = new Map<string, ComponentType<{ kernel: ReturnType<typeof useKernel> }>>();
    for (const p of panels) map.set(p.id, lazy(p.load) as ComponentType<{ kernel: ReturnType<typeof useKernel> }>);
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panels]);

  function floatPanel(id: string): void {
    if (instance.floating.some((f) => f.id === id)) return;
    onUpdate({ floating: [...instance.floating, { id, x: 140, y: 90, w: 360, h: 480 }] });
  }
  function dockPanel(id: string): void {
    const p = panels.find((x) => x.id === id);
    if (p?.defaultDock === "floating") {
      onUpdate({ hiddenPanels: instance.hiddenPanels.includes(id) ? instance.hiddenPanels : [...instance.hiddenPanels, id] });
    } else {
      onUpdate({ floating: instance.floating.filter((f) => f.id !== id) });
    }
  }
  function patchFloating(id: string, patch: Partial<FloatingState>): void {
    onUpdate({
      floating: instance.floating.some((f) => f.id === id)
        ? instance.floating.map((f) => (f.id === id ? { ...f, ...patch } : f))
        : [...instance.floating, { id, x: 140, y: 90, w: 360, h: 480, ...patch }],
    });
  }

  /** 拖拽中：更新位置 + 计算吸附目标（贴靠 dock 预览，m2） */
  function handleFloatMove(id: string, x: number, y: number, w: number, h: number): void {
    patchFloating(id, { x, y, w, h });
    setSnapTarget(computeSnap(x, y, w, h));
  }
  /** 拖拽结束：吸附目标存在 → 回停靠；否则保持浮窗 */
  function handleFloatDrop(id: string): void {
    if (snapTarget) dockPanel(id);
    setSnapTarget(null);
  }
  /** 吸附判断：靠近左/右栏槽或主区上缘 → 对应目标（m2 浮窗贴靠） */
  function computeSnap(x: number, y: number, w: number, h: number): "left" | "right" | "main" | null {
    const vw = window.innerWidth;
    if (x < 60) return "left";
    if (x + w > vw - 60) return "right";
    if (y < 48) return "main";
    return null;
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

  return (
    <div className="workspace">
      {/* 左侧栏：停靠面板（tab 切换；双击 tab 浮起） */}
      <div
        className={`sidebar${instance.collapsed.left ? " collapsed" : ""}`}
        style={{ width: instance.collapsed.left ? undefined : instance.widths.left }}
      >
        {leftPanels.length > 0 && (
          <div className="panel-tabs">
            {leftPanels.map((p) => (
              <button
                key={p.id}
                className={`panel-tab${leftPanel?.id === p.id ? " active" : ""}`}
                onClick={() => onUpdate({ activeLeftPanelId: p.id })}
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
      {!instance.collapsed.left && (
        <Resizer side="left" initialWidth={instance.widths.left} onResize={(t) => onUpdate({ widths: { ...instance.widths, left: clamp(t, 160, 480) } })} />
      )}

      {/* 主区：活动驱动的主面板 */}
      <div className="main">
        {mainPanel ? renderPanel(mainPanel, "加载工作区…") : <div className="main-empty" />}
      </div>

      {!instance.collapsed.right && (
        <Resizer side="right" initialWidth={instance.widths.right} onResize={(t) => onUpdate({ widths: { ...instance.widths, right: clamp(t, 160, 480) } })} />
      )}

      {/* 右侧栏：停靠面板 */}
      <div
        className={`rightbar${instance.collapsed.right ? " collapsed" : ""}`}
        style={{ width: instance.collapsed.right ? undefined : instance.widths.right }}
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

      {/* 浮窗层 */}
      {floatingAll.map((p) => {
        const fs = instance.floating.find((f) => f.id === p.id);
        return (
          <FloatingPanel
            key={p.id}
            title={p.title}
            x={fs?.x ?? 140}
            y={fs?.y ?? 90}
            w={fs?.w ?? 360}
            h={fs?.h ?? 480}
            onMove={(x, y, w, h) => handleFloatMove(p.id, x, y, w, h)}
            onResize={(w, h) => patchFloating(p.id, { w, h })}
            onDrop={() => handleFloatDrop(p.id)}
            onClose={() => dockPanel(p.id)}
          >
            {renderPanel(p)}
          </FloatingPanel>
        );
      })}
      {/* 浮窗贴靠吸附预览（m2） */}
      {snapTarget && <div className={`snap-highlight snap-${snapTarget}`} />}
    </div>
  );
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

/** 可拖拽分隔条：左右栏宽度的拖拽把手（图标化，m2）。W5：window blur 兜底 + 卸载清理 */
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

  React.useEffect(() => () => cleanupRef.current?.(), []);

  return (
    <div className={`resizer resizer-${side}`} onMouseDown={onMouseDown} title="拖拽调整栏宽">
      <GripVertical size={14} />
    </div>
  );
}
