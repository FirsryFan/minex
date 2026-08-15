import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MinexKernel } from "@minex/kernel";
import { encodeNodeRadius, MAX_RADIUS } from "./graph-encode.js";
import { layoutGraph, splitGraph, type GraphData, type GraphSource } from "./index.js";

/** 会话最小结构（方法图直取，跨包零源码 import） */
interface SessionLikeForGraph {
  nodes?: Array<{ id: string; kind?: string; toolName?: string }>;
}

type View = "tree" | "method";

/**
 * 通用可交互图谱画布（3-5 + F-B + P3-A）：
 * - 面板专属会话树 + 方法图双视图（icon tab：🕸 会话树 / ⚙ 方法图，字形零依赖）；
 * - 会话树：固定 graphSource「会话树」；splitGraph 连通块——focusId（选中会话）所在块自动显示，
 *   无「会话系 N」tab；focusId 三路来源：图谱点击 / minex:openSession 订阅 / 默认首会话；
 * - 方法图：focusId 会话的工具调用链（session 能力直取 tool 节点按序 + 相邻连边，与 graphSource
 *   workflow 同逻辑）；无工具调用 → 空态；
 * - 交互：wheel 缩放（鼠标锚点）+ pointer 拖拽平移 + reset（100% + 选中节点居中）；
 * - 视觉（§一）：无填充圆 + 主题色边框 2px + 大小编码；选中 = accent ring；hover 信息栏 + 图例。
 * 零依赖：SVG 线 + div 圆 + CSS transform。
 */
export default function GraphView({ kernel }: { kernel: MinexKernel }) {
  const [tick, setTick] = useState(0);
  const sources = useMemo<GraphSource[]>(
    () => kernel.registry.query<GraphSource>("graphSource").map((c) => c.value),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [kernel, tick],
  );
  const source = sources.find((s) => s.title === "会话树") ?? null;

  const [view, setView] = useState<View>("tree");
  const [graph, setGraph] = useState<GraphData | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null); // P3-A：选中会话（决定显示哪个连通块/方法图）
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [methodGraph, setMethodGraph] = useState<GraphData | null>(null);
  const [transform, setTransform] = useState({ scale: 1, x: 0, y: 0 });

  const containerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null);
  const centeredRef = useRef(false);
  const transformRef = useRef(transform);
  useEffect(() => {
    transformRef.current = transform;
  }, [transform]);

  const refresh = useCallback(async (): Promise<void> => {
    if (!source) {
      setGraph(null);
      return;
    }
    try {
      setGraph(await source.getData());
    } catch {
      setGraph(null);
    }
  }, [source]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const offs: Array<() => void> = [];
    offs.push(kernel.registry.onChange("*", () => setTick((t) => t + 1)));
    offs.push(kernel.events.on("minex:dataChanged", () => void refresh()));
    return () => offs.forEach((off) => off());
  }, [kernel, refresh]);

  // P3-A：focusId 默认 = 图数据首会话；数据刷新后若 focusId 已不存在 → 回落首会话
  useEffect(() => {
    if (!graph || graph.nodes.length === 0) return;
    setFocusId((cur) => (cur && graph.nodes.some((n) => n.id === cur) ? cur : graph.nodes[0].id));
  }, [graph]);

  // P3-A：外部打开会话（总览/图谱）→ 跟随
  useEffect(() => {
    return kernel.events.on("minex:openSession", (payload) => {
      const p = payload as { id?: string } | undefined;
      if (p?.id) setFocusId(p.id);
    });
  }, [kernel]);

  // P3-A：连通块 = focusId 所在块（未命中 → 第一块）
  const blocks = useMemo(() => (graph ? splitGraph(graph) : []), [graph]);
  const activeBlockIdx = blocks.findIndex((b) => b.nodes.some((n) => n.id === focusId));
  const activeBlock = blocks[activeBlockIdx >= 0 ? activeBlockIdx : 0] ?? null;

  // P3-A：方法图数据 = focusId 会话工具调用链（session 能力直取）
  useEffect(() => {
    if (view !== "method") return;
    let alive = true;
    void (async () => {
      const store = kernel.registry
        .get<{ loadSession(id: string): Promise<SessionLikeForGraph | undefined> }>("session", "default")?.value;
      if (!store || !focusId) {
        if (alive) setMethodGraph(null);
        return;
      }
      const s = await store.loadSession(focusId);
      const toolNodes = (s?.nodes ?? []).filter((n) => n.kind === "tool");
      if (!alive) return;
      setMethodGraph({
        nodes: toolNodes.map((n, i) => ({
          id: n.id,
          label: `工具 ${n.toolName ?? "?"}`,
          group: "步骤",
          meta: { nodeCount: i + 1 },
        })),
        edges: toolNodes.slice(1).map((n, i) => ({ from: toolNodes[i].id, to: n.id })),
      });
    })();
    return () => {
      alive = false;
    };
  }, [view, focusId, kernel]);

  // 当前视图数据（树 = focus 块；方法图 = 工具链）
  const viewGraph: GraphData | null = view === "tree" ? activeBlock : methodGraph;

  const layout = useMemo(() => (viewGraph ? layoutGraph(viewGraph) : {}), [viewGraph]);
  const worldSize = useMemo(() => {
    if (!viewGraph || viewGraph.nodes.length === 0) return { w: 0, h: 0 };
    const maxX = Math.max(...viewGraph.nodes.map((n) => (layout[n.id]?.x ?? 0) + MAX_RADIUS * 2));
    const maxY = Math.max(...viewGraph.nodes.map((n) => (layout[n.id]?.y ?? 0) + MAX_RADIUS * 2));
    return { w: maxX + 40, h: maxY + 40 };
  }, [viewGraph, layout]);
  const lines = useMemo(() => {
    if (!viewGraph) return [];
    return viewGraph.edges
      .map((e) => {
        const p = layout[e.from];
        const c = layout[e.to];
        if (!p || !c) return null;
        return { key: `${e.from}→${e.to}`, x1: p.x + MAX_RADIUS, y1: p.y + MAX_RADIUS, x2: c.x + MAX_RADIUS, y2: c.y + MAX_RADIUS };
      })
      .filter((l): l is NonNullable<typeof l> => l !== null);
  }, [viewGraph, layout]);

  /** 把节点置于画布中心（scale 指定）：屏幕 = 世界 × scale + translate（几何锚点 = 布局点 + MAX_RADIUS） */
  function centerOn(id: string | null, scale: number): void {
    const box = containerRef.current;
    const vw = box?.clientWidth ?? 400;
    const vh = box?.clientHeight ?? 300;
    const p = id ? layout[id] : undefined;
    setTransform({
      scale,
      x: vw / 2 - ((p?.x ?? 0) + MAX_RADIUS) * scale,
      y: vh / 2 - ((p?.y ?? 0) + MAX_RADIUS) * scale,
    });
  }

  // 首次数据加载居中 + 缩放适应（单节点 1.2 / 多节点 0.9）；空图重臂
  useEffect(() => {
    if (viewGraph && viewGraph.nodes.length > 0 && !centeredRef.current) {
      centeredRef.current = true;
      centerOn(selectedId, viewGraph.nodes.length <= 1 ? 1.2 : 0.9);
    } else if (viewGraph && viewGraph.nodes.length === 0) {
      centeredRef.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewGraph]);

  // P3-A：切换视图 / 切换连通块 → 重新居中
  useEffect(() => {
    centeredRef.current = false;
    setSelectedId(null);
  }, [view, activeBlockIdx]);

  useEffect(() => {
    const onMove = (e: PointerEvent): void => {
      if (!dragRef.current) return;
      const d = dragRef.current;
      setTransform((t) => ({ ...t, x: d.ox + (e.clientX - d.sx), y: d.oy + (e.clientY - d.sy) }));
    };
    const onUp = (): void => {
      dragRef.current = null;
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, []);

  function onPointerDown(e: React.PointerEvent): void {
    if ((e.target as Element).closest(".graph-node")) return; // 节点点击不拖
    dragRef.current = { sx: e.clientX, sy: e.clientY, ox: transformRef.current.x, oy: transformRef.current.y };
  }

  function onWheel(e: React.WheelEvent): void {
    const box = containerRef.current;
    if (!box) return;
    const rect = box.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    setTransform((t) => {
      const scale = Math.min(3, Math.max(0.3, t.scale * factor));
      const k = scale / t.scale;
      return { scale, x: mx - (mx - t.x) * k, y: my - (my - t.y) * k };
    });
  }

  function resetView(): void {
    centerOn(selectedId, 1);
  }

  /** 节点点击：选中（ring）+ focusId 跟随 + 树视图下打开会话钩子 */
  function clickNode(id: string, label: string): void {
    setSelectedId(id);
    setFocusId(id); // P3-A：点击哪个会话就显示哪个会话系
    centerOn(id, 1);
    if (view === "tree") source?.onNodeClick?.({ id, label });
  }

  const hovered = viewGraph?.nodes.find((n) => n.id === hoverId) ?? null;
  const focusTitle = graph?.nodes.find((n) => n.id === focusId)?.label ?? "";

  return (
    <div className="graph-view">
      {/* P3-A：视图切换（icon tab：会话树 / 方法图，字形零依赖） */}
      <div className="graph-view-tabs">
        <button
          className={`graph-view-tab${view === "tree" ? " active" : ""}`}
          title="会话树"
          onClick={() => setView("tree")}
        >
          🕸
        </button>
        <button
          className={`graph-view-tab${view === "method" ? " active" : ""}`}
          title="方法图（当前会话工具调用链）"
          onClick={() => setView("method")}
        >
          ⚙
        </button>
      </div>

      {/* P3-A：信息行（树 = 当前会话系；方法图 = 当前会话） */}
      <div className="graph-focus-info muted">
        {view === "tree"
          ? `当前会话系：${activeBlock?.nodes.length ?? 0} 个会话`
          : `方法图：${focusTitle || "未选择会话"}`}
      </div>

      <div className="graph-canvas" ref={containerRef} onWheel={onWheel} onPointerDown={onPointerDown}>
        {/* hover 信息栏（唯一文字出口） */}
        <div className="graph-info">
          {hovered ? (
            <>
              <span className="graph-info-title">{hovered.label}</span>
              <span className="muted">
                {hovered.meta?.nodeCount !== undefined ? `${String(hovered.meta.nodeCount)} 消息` : ""}
                {hovered.group ? ` · ${hovered.group}` : ""}
              </span>
            </>
          ) : (
            <span className="muted">悬停查看</span>
          )}
        </div>
        {worldSize.w > 0 && (
          <div
            className="graph-world"
            style={{
              width: worldSize.w,
              height: worldSize.h,
              transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
              transformOrigin: "0 0",
            }}
          >
            <svg className="graph-lines" width={worldSize.w} height={worldSize.h}>
              {lines.map((l) => (
                <line key={l.key} x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} />
              ))}
            </svg>
            {viewGraph?.nodes.map((n) => {
              const p = layout[n.id];
              if (!p) return null;
              const nodeCount = typeof n.meta?.nodeCount === "number" ? n.meta.nodeCount : 0;
              const r = encodeNodeRadius(nodeCount);
              const off = MAX_RADIUS - r;
              return (
                <div
                  key={n.id}
                  className={`graph-node${selectedId === n.id ? " selected" : ""}${hoverId === n.id ? " hover" : ""}`}
                  style={{
                    left: p.x + off,
                    top: p.y + off,
                    width: r * 2,
                    height: r * 2,
                    background: "transparent", // §一：无填充圆
                    border: "2px solid var(--color-primary)",
                  }}
                  onClick={() => clickNode(n.id, n.label)}
                  onMouseEnter={() => setHoverId(n.id)}
                  onMouseLeave={() => setHoverId(null)}
                  title={n.label}
                />
              );
            })}
          </div>
        )}
        {graph && graph.nodes.length === 0 && <div className="muted graph-empty">暂无会话</div>}
        {view === "method" && methodGraph && methodGraph.nodes.length === 0 && (
          <div className="muted graph-empty">该会话无工具调用</div>
        )}
        {!source && <div className="muted graph-empty">暂无会话树数据源</div>}
        <div className="graph-legend">○ 大小 = 消息数</div>
        <button className="graph-reset" title="重置视角（100% + 选中节点居中）" onClick={resetView}>
          ⟳
        </button>
      </div>
    </div>
  );
}
