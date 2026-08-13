import React, { Suspense, lazy, useEffect, useMemo, useState } from "react";
import type { ComponentType } from "react";
import { GripVertical } from "lucide-react";
import { FloatingPanel } from "./components/FloatingPanel.js";
import { SettingsPage } from "./components/SettingsPage.js";
import { ThemeManager } from "./components/ThemeManager.js";
import { TopBar } from "./components/TopBar.js";
import { useKernel } from "./kernel-context.js";
import { queryPanels, type PanelContribution, type PanelDock } from "./panels.js";

const ACTIVE_DRIVER_KEY = "minex.activeDriver";
const THEME_KEY = "minex.theme";

interface FloatingState {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 面板运行时停靠状态：left/right/main/floating，或 hidden（默认浮窗关闭后隐藏） */
type DockState = PanelDock | "hidden";

/** 一个工作视图（S4 多开实例）的全部布局状态：活动驱动 + 栏宽折叠 + 面板停靠态 + 浮窗位置 */
interface InstanceState {
  id: number;
  name: string;
  activeDriverId: string | null;
  collapsed: { left: boolean; right: boolean };
  widths: { left: number; right: number };
  activeLeftPanelId: string | null;
  /** 面板运行时停靠状态：defaultDock 为回退；浮起/吸附/关闭改之（审查 BLOCKER：吸附决定 dock 位置） */
  dockState: Record<string, DockState>;
  /** 浮窗位置（仅 floating 面板记录） */
  floatingPos: Record<string, FloatingState>;
}

function makeInstance(id: number, name: string): InstanceState {
  return {
    id,
    name,
    activeDriverId: typeof localStorage !== "undefined" ? localStorage.getItem(ACTIVE_DRIVER_KEY) : null,
    collapsed: { left: false, right: false },
    widths: { left: 220, right: 220 },
    activeLeftPanelId: null,
    dockState: {},
    floatingPos: {},
  };
}

/**
 * 外壳（S3 面板化 + S4 多开）：驱动贡献「面板」，外壳按运行时 dockState 渲染停靠面板（左/右/主区）+ 浮窗层。
 * - 工作视图多开：每实例独立布局状态，view-strip 切换/新建/关闭
 * - 面板浮起（双击 dock tab）、吸附 dock（拖到目标槽，释放停靠到吸附目标）、浮窗拖拽/缩放
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
  const [taskViewOpen, setTaskViewOpen] = useState(false);
  const activeInstance = instances.find((i) => i.id === activeInstanceId) ?? instances[0];

  useEffect(() => {
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    try {
      localStorage.setItem(THEME_KEY, dark ? "dark" : "light");
    } catch {
      /* localStorage 不可用 */
    }
  }, [dark]);

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

  // 任务视图弹窗：Esc 关闭
  useEffect(() => {
    if (!taskViewOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setTaskViewOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [taskViewOpen]);

  function selectInstance(id: number): void {
    setActiveInstanceId(id);
    setTaskViewOpen(false);
  }

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
        onOpenTaskView={() => setTaskViewOpen((o) => !o)}
        taskViewActive={taskViewOpen}
      />
      <WorkspaceInstance
        key={activeInstanceId}
        kernel={kernel}
        instance={activeInstance}
        onUpdate={(patch) => updateInstance(activeInstanceId, patch)}
      />

      {/* 任务视图弹窗（Windows 任务视图风格：横向预览浮窗，点击预览切换工作区） */}
      {taskViewOpen && (
        <div className="taskview-overlay" onClick={() => setTaskViewOpen(false)}>
          <div className="taskview-popup" onClick={(e) => e.stopPropagation()}>
            {instances.map((inst) => (
              <div
                key={inst.id}
                className={`taskview-card${inst.id === activeInstanceId ? " active" : ""}`}
                onClick={() => selectInstance(inst.id)}
                title={inst.name}
              >
                <div className="taskview-thumb">
                  <div className="thumb-side thumb-left" />
                  <div className="thumb-main" />
                  <div className="thumb-side thumb-right" />
                </div>
                <div className="taskview-name">{inst.name}</div>
                {instances.length > 1 && (
                  <button className="taskview-close" title="关闭工作区" onClick={(e) => { e.stopPropagation(); closeInstance(inst.id); }}>
                    ×
                  </button>
                )}
              </div>
            ))}
            <button className="taskview-add" onClick={addInstance}>＋ 新建工作区</button>
          </div>
        </div>
      )}
    </div>
  );
}

/** 一个工作视图实例：按运行时 dockState 渲染停靠面板（左/右/主区）+ 浮窗层（S4 多开） */
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
  const [snapTarget, setSnapTarget] = useState<PanelDock | null>(null);

  useEffect(() => {
    const offs: Array<() => void> = [];
    offs.push(kernel.registry.onChange("*", () => setTick((t) => t + 1)));
    offs.push(kernel.events.on("minex:dataChanged", () => setTick((t) => t + 1)));
    return () => offs.forEach((off) => off());
  }, [kernel]);

  const panels = useMemo<PanelContribution[]>(() => queryPanels(kernel), [kernel, tick]);

  // 面板运行时停靠状态（defaultDock 回退；"hidden" 不渲染）
  const dockOf = (p: PanelContribution): DockState => instance.dockState[p.id] ?? p.defaultDock;
  const leftPanels = panels.filter((p) => dockOf(p) === "left");
  const rightPanels = panels.filter((p) => dockOf(p) === "right");
  const mainPanel = panels.find((p) => dockOf(p) === "main" && p.driverId === instance.activeDriverId);
  const floatingAll = panels.filter((p) => dockOf(p) === "floating");
  const leftPanel = leftPanels.find((p) => p.id === instance.activeLeftPanelId) ?? leftPanels[0];

  const panelLazy = useMemo(() => {
    const map = new Map<string, ComponentType<{ kernel: ReturnType<typeof useKernel> }>>();
    for (const p of panels) map.set(p.id, lazy(p.load) as ComponentType<{ kernel: ReturnType<typeof useKernel> }>);
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panels]);

  /** 浮起：dockState → floating（并初始化浮窗位置） */
  function floatPanel(id: string): void {
    const p = panels.find((x) => x.id === id);
    if (!p || dockOf(p) === "floating") return;
    onUpdate({
      dockState: { ...instance.dockState, [id]: "floating" },
      floatingPos: {
        ...instance.floatingPos,
        [id]: { id, x: 140, y: 90, w: 360, h: 480 },
      },
    });
  }
  /** 停靠到目标槽：吸附 → 吸附目标；关闭 → defaultDock（默认浮窗关闭 = hidden） */
  function dockPanel(id: string, target?: PanelDock): void {
    const p = panels.find((x) => x.id === id);
    const to: DockState = target ?? (p?.defaultDock === "floating" ? "hidden" : p?.defaultDock ?? "left");
    onUpdate({ dockState: { ...instance.dockState, [id]: to } });
  }
  /** 浮窗位置更新（拖拽/缩放） */
  function patchFloating(id: string, patch: Partial<FloatingState>): void {
    const cur = instance.floatingPos[id] ?? { id, x: 140, y: 90, w: 360, h: 480 };
    onUpdate({ floatingPos: { ...instance.floatingPos, [id]: { ...cur, ...patch } } });
  }

  /** 拖拽中：更新位置 + 吸附目标（按槽位几何，审查 m1） */
  function handleFloatMove(id: string, x: number, y: number, w: number, h: number): void {
    patchFloating(id, { x, y, w, h });
    setSnapTarget(computeSnap(x, y, w, h));
  }
  /** 拖拽结束：吸附 → 停靠到吸附目标（BLOCKER 修复：吸附决定 dock 位置） */
  function handleFloatDrop(id: string): void {
    if (snapTarget) dockPanel(id, snapTarget);
    setSnapTarget(null);
  }
  /** 吸附判断：靠近左栏 / 右栏槽（按右栏左边缘几何）/ 主区上缘 */
  function computeSnap(x: number, y: number, w: number, h: number): PanelDock | null {
    const vw = window.innerWidth;
    if (x < 60) return "left";
    if (x + w > vw - instance.widths.right - 20) return "right"; // 靠近右栏槽（非窗口边缘，审查 m1）
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
      {/* 左侧栏 */}
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

      {/* 主区 */}
      <div className="main">
        {mainPanel ? renderPanel(mainPanel, "加载工作区…") : <div className="main-empty" />}
      </div>

      {!instance.collapsed.right && (
        <Resizer side="right" initialWidth={instance.widths.right} onResize={(t) => onUpdate({ widths: { ...instance.widths, right: clamp(t, 160, 480) } })} />
      )}

      {/* 右侧栏 */}
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
        const fs = instance.floatingPos[p.id];
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
    const base = initialWidth;
    const dir = side === "left" ? 1 : -1;
    const move = (ev: MouseEvent) => onResize(base + dir * (ev.clientX - startX));
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      window.removeEventListener("blur", up);
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
