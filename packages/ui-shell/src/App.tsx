import React, { Suspense, lazy, useEffect, useMemo, useRef, useState } from "react";
import type { ComponentType } from "react";
import { ExternalLink, GripVertical, PanelRight } from "lucide-react";
import { FloatingPanel } from "./components/FloatingPanel.js";
import { SettingsPage } from "./components/SettingsPage.js";
import { ThemeManager } from "./components/ThemeManager.js";
import { TopBar } from "./components/TopBar.js";
import { useKernel } from "./kernel-context.js";
import { queryPanels, type PanelContribution, type PanelDock } from "./panels.js";
import { panelIcon } from "./panel-icons.js";
import { setPendingOpenSessionId } from "../../agent-driver/src/session-open.js";
import type { SessionLike } from "../../agent-driver/src/chat-history.js";
// 3-6：ChatView 静态 import 改 lazy（消 vite 双 import 警告；使用处包 Suspense）
const ChatView = lazy(() => import("../../agent-driver/src/chat-view.js"));

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
  /** 2-R1 浮窗展开：新实例以该会话为上下文打开（会话加载经 session-open 桥接，本字段为可查元数据） */
  pendingSession?: { sessionId: string; branchId?: string };
  /** F-G 概念修正：打开的会话 id（minex:openSession 写入；agent 驱动主区 = 聊天会话模式，
   *   否则 = 配置中心；切驱动清空） */
  openSessionId?: string | null;
}

function makeInstance(
  id: number,
  name: string,
  pendingSession?: { sessionId: string; branchId?: string },
): InstanceState {
  return {
    id,
    name,
    activeDriverId: typeof localStorage !== "undefined" ? localStorage.getItem(ACTIVE_DRIVER_KEY) : null,
    collapsed: { left: false, right: false },
    widths: { left: 220, right: 220 },
    activeLeftPanelId: null,
    dockState: {},
    floatingPos: {},
    ...(pendingSession ? { pendingSession } : {}),
  };
}

/** 左栏面板可见性（F-H 定案）：文件系统常驻（任何驱动）；会话域面板（会话总览 + 图谱=会话树视图）
 *  仅 session 驱动显示；agent 域面板仅 agent 驱动显示；其余按驱动匹配。右栏/浮窗已拆放面板不受影响（P2 不回归）。 */
function leftPanelVisible(p: PanelContribution, activeDriverId: string | null): boolean {
  if (p.id === "minex.filesystem.sidebar") return true; // 文件系统常驻
  if (p.driverId === "mist.session" || p.id === "minex.graph.view") {
    return activeDriverId === "mist.session"; // 会话筛选仅会话驱动（图谱 = 会话树视图）
  }
  if (p.driverId === "minex.agent") return activeDriverId === "minex.agent"; // agent 相关仅 agent 驱动
  return p.driverId === activeDriverId;
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
  // 2-3 浮窗子对话：聊天内框选 → minex:openChildChat → 外壳浮窗承载迷你 ChatView。
  // 热修：x/y/w/h 入 state，onMove/onResize 真实更新——修复拖拽 no-op 导致拖不动。
  // 2-R1/R-A：selectionText —— quick phrase 模板 {selection} 槽预填（模板下拉在浮窗输入区）。
  const [childChat, setChildChat] = useState<{
    childSession: SessionLike;
    contextItems: Array<{ ref: string; content: string }>;
    parentSession: SessionLike;
    selectionText?: string;
    x: number;
    y: number;
    w: number;
    h: number;
  } | null>(null);
  const activeInstance = instances.find((i) => i.id === activeInstanceId) ?? instances[0];

  useEffect(() => {
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    try {
      localStorage.setItem(THEME_KEY, dark ? "dark" : "light");
    } catch {
      /* localStorage 不可用 */
    }
  }, [dark]);

  // 文件树点击 → 目标工作视图切到 markdown（openFile 定向到 targetInstanceId；缺省当前实例）
  // F-G：切驱动统一清空 openSessionId（打开会话状态只由 minex:openSession 写）
  useEffect(() => {
    return kernel.events.on("filesystem:openFile", (payload) => {
      const p = payload as { targetInstanceId?: number } | undefined;
      const targetId = p?.targetInstanceId ?? activeInstanceId;
      updateInstance(targetId, { activeDriverId: "minex.markdown", openSessionId: undefined });
      try {
        localStorage.setItem(ACTIVE_DRIVER_KEY, "minex.markdown");
      } catch {
        /* localStorage 不可用 */
      }
    });
  }, [kernel, activeInstanceId]);

  // 会话总览/图谱「打开会话」→ 暂存会话 id（ChatView 挂载竞态桥接）+ 切到会话驱动（2-2；F-H：mist.session）
  // F-G：写 openSessionId——主区 = 聊天会话模式（驱动无关）
  useEffect(() => {
    return kernel.events.on("minex:openSession", (payload) => {
      const p = payload as { id?: string; targetInstanceId?: number } | undefined;
      if (!p?.id) return;
      setPendingOpenSessionId(p.id);
      const targetId = p.targetInstanceId ?? activeInstanceId;
      updateInstance(targetId, { activeDriverId: "mist.session", openSessionId: p.id });
      try {
        localStorage.setItem(ACTIVE_DRIVER_KEY, "mist.session");
      } catch {
        /* localStorage 不可用 */
      }
    });
  }, [kernel, activeInstanceId]);

  // 2-3 浮窗子对话：聊天内框选 → 打开子对话浮窗（复用会话模式 ChatView）
  // P5 关闭询问：childHandleRef 持有子对话的 dirty/save 句柄；dirty 时弹「保存为会话/放弃」
  const childHandleRef = useRef<{ dirty: boolean; save: () => Promise<void> } | null>(null);
  const [showChildSavePrompt, setShowChildSavePrompt] = useState(false);
  useEffect(() => {
    return kernel.events.on("minex:openChildChat", (payload) => {
      const p = payload as {
        childSession?: SessionLike;
        contextItems?: unknown[];
        parentSession?: SessionLike;
        selectionText?: string;
      } | undefined;
      if (!p?.childSession || !p.parentSession) return;
      childHandleRef.current = null; // 新子对话重置句柄
      const vw = typeof window !== "undefined" ? window.innerWidth : 1024;
      setChildChat({
        childSession: p.childSession,
        contextItems: (p.contextItems ?? []) as Array<{ ref: string; content: string }>,
        parentSession: p.parentSession,
        selectionText: p.selectionText ?? "",
        x: Math.max(0, vw - 600),
        y: 80,
        w: 480,
        h: 600,
      });
    });
  }, [kernel]);

  // 2-R1 浮窗展开为新工作区（P6）：新实例 + Agent 驱动 + 会话模式打开（session-open 桥接挂载竞态）
  useEffect(() => {
    return kernel.events.on("minex:expandToWorkspace", (payload) => {
      const p = payload as { sessionId?: string; branchId?: string } | undefined;
      if (!p?.sessionId) return;
      setPendingOpenSessionId(p.sessionId); // 先桥接：新实例 ChatView 挂载时 take（子组件 effect 先于父组件）
      const nextId = Math.max(0, ...instances.map((i) => i.id)) + 1;
      setInstances((prev) => [
        ...prev,
        makeInstance(nextId, `工作区 ${prev.length + 1}`, { sessionId: p.sessionId!, branchId: p.branchId }),
      ]);
      updateInstance(nextId, { activeDriverId: "mist.session", openSessionId: p.sessionId }); // F-H：展开 = 会话驱动 + 主区聊天
      setActiveInstanceId(nextId);
      setChildChat(null); // 原浮窗关闭（内容已在新工作区）
      try {
        localStorage.setItem(ACTIVE_DRIVER_KEY, "mist.session");
      } catch {
        /* localStorage 不可用 */
      }
    });
  }, [kernel, instances]);

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
    // F-G：切驱动统一清空 openSessionId——切回 Agent 默认主区 = 配置中心（不自动回聊天）
    updateInstance(activeInstanceId, { activeDriverId: id, openSessionId: undefined });
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

      {/* 2-3 浮窗子对话（框选 → 与 AI 讨论这段）：复用会话模式 ChatView（contextItems + parentSession）。
          热修：onMove/onResize 真实更新 state（拖拽/缩放生效）；P5：dirty 时关闭弹「保存为会话/放弃」。 */}
      {childChat && (
        <FloatingPanel
          title="子对话"
          x={childChat.x}
          y={childChat.y}
          w={childChat.w}
          h={childChat.h}
          onMove={(x, y, w, h) => setChildChat((c) => (c ? { ...c, x, y, w, h } : c))}
          onResize={(w, h) => setChildChat((c) => (c ? { ...c, w, h } : c))}
          onDrop={() => {}}
          onClose={() => {
            if (childHandleRef.current?.dirty) setShowChildSavePrompt(true);
            else setChildChat(null);
          }}
        >
          <Suspense fallback={<div className="loading">加载聊天…</div>}>
            <ChatView
              kernel={kernel}
              session={childChat.childSession}
              contextItems={childChat.contextItems}
              parentSession={childChat.parentSession}
              selectionText={childChat.selectionText}
              onStateChange={(h) => {
                childHandleRef.current = h;
              }}
            />
          </Suspense>
        </FloatingPanel>
      )}

      {/* P5 关闭询问：草稿未保存且消息非空 → 保存为会话/放弃 */}
      {showChildSavePrompt && (
        <div className="floating-mask" onClick={() => setShowChildSavePrompt(false)}>
          <div className="confirm-box" onClick={(e) => e.stopPropagation()}>
            <p>会话尚未保存，要保存为会话吗？</p>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 12 }}>
              <button
                className="btn-ghost"
                onClick={() => {
                  setShowChildSavePrompt(false);
                  setChildChat(null);
                }}
              >
                放弃
              </button>
              <button
                className="btn"
                onClick={() => {
                  void (async () => {
                    await childHandleRef.current?.save();
                    setShowChildSavePrompt(false);
                    setChildChat(null);
                  })();
                }}
              >
                保存为会话
              </button>
            </div>
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
  // 2-R2 面板拆放：左栏 icon 右键菜单（移至右栏 / 浮起）
  const [panelMenu, setPanelMenu] = useState<{ panelId: string; x: number; y: number } | null>(null);

  useEffect(() => {
    const offs: Array<() => void> = [];
    offs.push(kernel.registry.onChange("*", () => setTick((t) => t + 1)));
    offs.push(kernel.events.on("minex:dataChanged", () => setTick((t) => t + 1)));
    return () => offs.forEach((off) => off());
  }, [kernel]);

  // 2-R2 右键菜单：Esc 关闭
  useEffect(() => {
    if (!panelMenu) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPanelMenu(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [panelMenu]);

  const panels = useMemo<PanelContribution[]>(() => queryPanels(kernel), [kernel, tick]);

  // 面板运行时停靠状态（defaultDock 回退；"hidden" 不渲染）
  const dockOf = (p: PanelContribution): DockState => instance.dockState[p.id] ?? p.defaultDock;
  // F-H：左栏按归属驱动过滤（文件常驻 / 会话面板仅会话驱动 / agent 面板仅 agent 驱动）
  const leftPanels = panels.filter((p) => dockOf(p) === "left" && leftPanelVisible(p, instance.activeDriverId));
  const rightPanels = panels.filter((p) => dockOf(p) === "right");
  // F-G/F-H 主区选择：打开会话（openSessionId）→ 主区 = 聊天（会话模式，驱动无关）；
  // agent 驱动 → 配置中心（默认）；其余驱动 → 该驱动主面板
  const mains = panels.filter((p) => dockOf(p) === "main" && p.driverId === instance.activeDriverId);
  // P1-5：聊天面板 dock 态——被用户拆放到右栏/浮窗后，openSessionId 分支不再落到 main
  const chatPanel = panels.find((p) => p.id === "minex.agent.chat");
  const chatDock = chatPanel ? dockOf(chatPanel) : undefined;
  const mainPanel = (() => {
    if (instance.openSessionId) {
      if (chatDock === "main") return chatPanel ?? mains[0];
      return undefined; // 聊天被拆放 → 主区占位提示（P1-5，v1 提示不挪动）
    }
    if (instance.activeDriverId === "minex.agent") {
      return mains.find((p) => p.id !== "minex.agent.chat") ?? mains[0]; // 配置中心
    }
    return mains[0];
  })();
  // F-H：会话驱动无打开会话 → 主区空态提示；P1-5：聊天被拆放 → 主区提示在右栏/浮窗
  const sessionEmpty = !mainPanel && instance.activeDriverId === "mist.session";
  const chatMovedHint =
    Boolean(instance.openSessionId) && chatDock !== undefined && chatDock !== "main"
      ? (chatDock === "floating" ? "聊天面板已在浮窗" : "聊天面板已在右栏")
      : null;
  const floatingAll = panels.filter((p) => dockOf(p) === "floating");
  const leftPanel = leftPanels.find((p) => p.id === instance.activeLeftPanelId) ?? leftPanels[0];

  const panelLazy = useMemo(() => {
    const map = new Map<string, ComponentType<{ kernel: ReturnType<typeof useKernel>; instanceId?: number }>>();
    for (const p of panels) {
      map.set(p.id, lazy(p.load) as ComponentType<{ kernel: ReturnType<typeof useKernel>; instanceId?: number }>);
    }
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
        [id]: { id, x: 140, y: 90, w: 480, h: 600 },
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
    const cur = instance.floatingPos[id] ?? { id, x: 140, y: 90, w: 480, h: 600 };
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
        {/* 注入 instanceId：面板组件可据此隔离 doc / openFile / lastOpenPath（多实例隔离） */}
        <Comp kernel={kernel} instanceId={instance.id} />
      </Suspense>
    );
  }

  return (
    <div className="workspace">
      {/* 左侧栏：2-R2 icon 栏（总池）——垂直 icon 按钮，点击切换 / 双击浮起 / 右键拆放 */}
      <div
        className={`sidebar${instance.collapsed.left ? " collapsed" : ""}`}
        style={{ width: instance.collapsed.left ? undefined : instance.widths.left }}
      >
        {leftPanels.length > 0 && (
          <div className="panel-iconbar">
            {leftPanels.map((p) => {
              const Icon = panelIcon(p.id);
              return (
                <button
                  key={p.id}
                  className={`panel-icon${leftPanel?.id === p.id ? " active" : ""}`}
                  onClick={() => onUpdate({ activeLeftPanelId: p.id })}
                  onDoubleClick={() => floatPanel(p.id)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setPanelMenu({ panelId: p.id, x: e.clientX, y: e.clientY });
                  }}
                  title="切换面板"
                >
                  <Icon size={18} />
                </button>
              );
            })}
          </div>
        )}
        {leftPanel && <div className="dock-panel">{renderPanel(leftPanel)}</div>}
      </div>

      {/* 2-R2 面板拆放右键菜单（移至右栏 / 浮起） */}
      {panelMenu && (
        <div className="floating-mask" onClick={() => setPanelMenu(null)}>
          <div
            className="panel-menu"
            style={{ left: panelMenu.x, top: panelMenu.y }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => {
                onUpdate({ dockState: { ...instance.dockState, [panelMenu.panelId]: "right" } });
                setPanelMenu(null);
              }}
            >
              <PanelRight size={14} /> 移至右栏
            </button>
            <button
              onClick={() => {
                floatPanel(panelMenu.panelId);
                setPanelMenu(null);
              }}
            >
              <ExternalLink size={14} /> 浮起
            </button>
          </div>
        </div>
      )}
      {!instance.collapsed.left && (
        <Resizer side="left" initialWidth={instance.widths.left} onResize={(t) => onUpdate({ widths: { ...instance.widths, left: clamp(t, 160, 480) } })} />
      )}

      {/* 主区 */}
      <div className="main">
        {mainPanel ? (
          renderPanel(mainPanel, "加载工作区…")
        ) : (
          // F-H/P1-5：空态提示——聊天被拆放（右栏/浮窗）优先，其次会话驱动未开会话
          <div className="main-empty">
            {chatMovedHint ? (
              <span className="muted">{chatMovedHint}，请在那里继续会话</span>
            ) : sessionEmpty ? (
              <span className="muted">在左侧会话列表或图谱选择会话打开</span>
            ) : null}
          </div>
        )}
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
            w={fs?.w ?? 480}
            h={fs?.h ?? 600}
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
