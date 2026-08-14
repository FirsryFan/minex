import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MinexKernel } from "@minex/kernel";
import { encodeNodeRadius, MAX_RADIUS } from "./graph-encode.js";
import { layoutGraph, type GraphData, type GraphSource } from "./index.js";

/**
 * 通用可交互图谱画布（3-5，id: minex.graph.view）：
 * - 数据 = graphSource 贡献（registry.query，.value 纪律）——source 切换器下拉；
 *   每次 getData 现取（新建/删除会话实时刷新）；
 * - 交互：wheel 缩放（鼠标锚点）+ pointer 拖拽平移 + reset（100% + 选中节点居中）；
 * - 视觉（§一 关系图改进）：无填充圆 + 主题色边框 2px + 大小 = 消息数对数（meta.nodeCount）；
 *   选中 = accent ring；hover 信息栏 + 图例「○ 大小 = 消息数」；
 * - 节点点击 → source.onNodeClick（会话树 → emit minex:openSession）。
 * 零依赖：SVG 线 + div 圆 + CSS transform（scale/translate）。
 */
export default function GraphView({ kernel, instanceId }: { kernel: MinexKernel; instanceId?: number }) {
  const [tick, setTick] = useState(0);
  const sources = useMemo<GraphSource[]>(
    () => kernel.registry.query<GraphSource>("graphSource").map((c) => c.value),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [kernel, tick],
  );
  const [sourceId, setSourceId] = useState<string>(() => sources[0]?.title ?? "");
  const [graph, setGraph] = useState<GraphData | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [transform, setTransform] = useState({ scale: 1, x: 0, y: 0 });

  const containerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null);
  const centeredRef = useRef(false);
  const transformRef = useRef(transform);
  useEffect(() => {
    transformRef.current = transform;
  }, [transform]);

  const source = sources.find((s) => s.title === sourceId) ?? sources[0] ?? null;
  useEffect(() => {
    if (source && !sources.some((s) => s.title === sourceId)) setSourceId(source.title);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sources]);

  const refresh = useCallback(async (): Promise<void> => {
    const s = sources.find((x) => x.title === sourceId) ?? sources[0] ?? null;
    if (!s) {
      setGraph(null);
      return;
    }
    try {
      setGraph(await s.getData());
    } catch {
      setGraph(null); // 数据源异常不崩
    }
  }, [sources, sourceId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // 订阅刷新：registry 变更（source 增删）+ 会话数据变更（graphSource 每次 getData 现取）
  useEffect(() => {
    const offs: Array<() => void> = [];
    offs.push(kernel.registry.onChange("*", () => setTick((t) => t + 1)));
    offs.push(kernel.events.on("minex:dataChanged", () => void refresh()));
    return () => offs.forEach((off) => off());
  }, [kernel, refresh]);

  const layout = useMemo(() => (graph ? layoutGraph(graph) : {}), [graph]);
  const worldSize = useMemo(() => {
    if (!graph || graph.nodes.length === 0) return { w: 0, h: 0 };
    const maxX = Math.max(...graph.nodes.map((n) => (layout[n.id]?.x ?? 0) + MAX_RADIUS * 2));
    const maxY = Math.max(...graph.nodes.map((n) => (layout[n.id]?.y ?? 0) + MAX_RADIUS * 2));
    return { w: maxX + 40, h: maxY + 40 };
  }, [graph, layout]);
  const lines = useMemo(() => {
    if (!graph) return [];
    return graph.edges
      .map((e) => {
        const p = layout[e.from];
        const c = layout[e.to];
        if (!p || !c) return null;
        return { key: `${e.from}→${e.to}`, x1: p.x + MAX_RADIUS, y1: p.y + MAX_RADIUS, x2: c.x + MAX_RADIUS, y2: c.y + MAX_RADIUS };
      })
      .filter((l): l is NonNullable<typeof l> => l !== null);
  }, [graph, layout]);

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
    if (graph && graph.nodes.length > 0 && !centeredRef.current) {
      centeredRef.current = true;
      centerOn(selectedId, graph.nodes.length <= 1 ? 1.2 : 0.9);
    } else if (graph && graph.nodes.length === 0) {
      centeredRef.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph]);

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

  /** 节点点击：选中（ring）+ source.onNodeClick 钩子（会话树 → openSession） */
  function clickNode(id: string, label: string): void {
    setSelectedId(id);
    centerOn(id, 1);
    source?.onNodeClick?.({ id, label });
  }

  const hovered = graph?.nodes.find((n) => n.id === hoverId) ?? null;

  return (
    <div className="graph-view">
      <div className="graph-source-switch">
        <select
          title="图谱数据源"
          value={source?.title ?? ""}
          onChange={(e) => {
            setSourceId(e.target.value);
            setSelectedId(null);
            centeredRef.current = false; // 切源后重新居中
          }}
        >
          {sources.length === 0 && <option value="">（无数据源）</option>}
          {sources.map((s) => (
            <option key={s.title} value={s.title}>
              {s.title}
            </option>
          ))}
        </select>
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
            <span className="muted">（悬停节点查看信息）</span>
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
            {graph?.nodes.map((n) => {
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
        {graph && graph.nodes.length === 0 && <div className="muted graph-empty">（暂无图数据）</div>}
        <div className="graph-legend">○ 大小 = 消息数</div>
        <button className="graph-reset" title="重置视角（100% + 选中节点居中）" onClick={resetView}>
          ⟳
        </button>
      </div>
    </div>
  );
}
