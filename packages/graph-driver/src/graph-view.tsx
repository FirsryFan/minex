import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MinexKernel } from "@minex/kernel";
import { encodeNodeRadius, MAX_RADIUS } from "./graph-encode.js";
import { layoutGraph, splitGraph, type GraphData, type GraphSource } from "./index.js";

/**
 * 通用可交互图谱画布（3-5 + F-B 反馈 3）：
 * - 面板专属会话树：固定消费 graphSource「会话树」（GraphSource 机制保留——graph_query 工具 / 后续接入，
 *   本面板不再切换 source）；每次 getData 现取（新建/删除会话实时刷新）；
 * - 连通块分图：splitGraph 按 edges 无向连通分量切分——一个会话系 = 一个连通块；多块时顶部「会话系 N」块 tab，
 *   一次显示一块、各块独立布局居中（切换块重置居中）；
 * - 交互：wheel 缩放（鼠标锚点）+ pointer 拖拽平移 + reset（100% + 选中节点居中）；
 * - 视觉（§一）：无填充圆 + 主题色边框 2px + 大小 = 消息数对数（meta.nodeCount）；选中 = accent ring；
 *   hover 信息栏 + 图例「○ 大小 = 消息数」；
 * - 节点点击 → source.onNodeClick（会话树 → emit minex:openSession）。
 * 零依赖：SVG 线 + div 圆 + CSS transform（scale/translate）。
 */
export default function GraphView({ kernel }: { kernel: MinexKernel }) {
  const [tick, setTick] = useState(0);
  const sources = useMemo<GraphSource[]>(
    () => kernel.registry.query<GraphSource>("graphSource").map((c) => c.value),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [kernel, tick],
  );
  // F-B：面板专属会话树（找不到 → 空态）
  const source = sources.find((s) => s.title === "会话树") ?? null;

  const [graph, setGraph] = useState<GraphData | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeBlock, setActiveBlock] = useState(0);
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
      setGraph(null); // 数据源异常不崩
    }
  }, [source]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // 订阅刷新：registry 变更（数据源增删）+ 会话数据变更（graphSource 每次 getData 现取）
  useEffect(() => {
    const offs: Array<() => void> = [];
    offs.push(kernel.registry.onChange("*", () => setTick((t) => t + 1)));
    offs.push(kernel.events.on("minex:dataChanged", () => void refresh()));
    return () => offs.forEach((off) => off());
  }, [kernel, refresh]);

  // F-B：连通块切分 + 当前块；块数变化时钳制 activeBlock（删除/新建会话 → 块结构实时刷新）
  const blocks = useMemo(() => (graph ? splitGraph(graph) : []), [graph]);
  const block = blocks[activeBlock] ?? null;
  useEffect(() => {
    if (blocks.length > 0 && activeBlock >= blocks.length) {
      setActiveBlock(blocks.length - 1);
      centeredRef.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blocks.length]);

  const layout = useMemo(() => (block ? layoutGraph(block) : {}), [block]);
  const worldSize = useMemo(() => {
    if (!block || block.nodes.length === 0) return { w: 0, h: 0 };
    const maxX = Math.max(...block.nodes.map((n) => (layout[n.id]?.x ?? 0) + MAX_RADIUS * 2));
    const maxY = Math.max(...block.nodes.map((n) => (layout[n.id]?.y ?? 0) + MAX_RADIUS * 2));
    return { w: maxX + 40, h: maxY + 40 };
  }, [block, layout]);
  const lines = useMemo(() => {
    if (!block) return [];
    return block.edges
      .map((e) => {
        const p = layout[e.from];
        const c = layout[e.to];
        if (!p || !c) return null;
        return { key: `${e.from}→${e.to}`, x1: p.x + MAX_RADIUS, y1: p.y + MAX_RADIUS, x2: c.x + MAX_RADIUS, y2: c.y + MAX_RADIUS };
      })
      .filter((l): l is NonNullable<typeof l> => l !== null);
  }, [block, layout]);

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
    if (block && block.nodes.length > 0 && !centeredRef.current) {
      centeredRef.current = true;
      centerOn(selectedId, block.nodes.length <= 1 ? 1.2 : 0.9);
    } else if (block && block.nodes.length === 0) {
      centeredRef.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [block]);

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

  const hovered = block?.nodes.find((n) => n.id === hoverId) ?? null;

  return (
    <div className="graph-view">
      {/* F-B：连通块 tab（一个会话系 = 一个连通块；单块不显示） */}
      {blocks.length > 1 && (
        <div className="graph-block-tabs">
          {blocks.map((b, i) => (
            <button
              key={i}
              className={`graph-block-tab${i === activeBlock ? " active" : ""}`}
              onClick={() => {
                setActiveBlock(i);
                setSelectedId(null);
                centeredRef.current = false; // 切块重新居中
              }}
            >
              会话系 {i + 1}
            </button>
          ))}
        </div>
      )}

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
            {block?.nodes.map((n) => {
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
        {!source && <div className="muted graph-empty">暂无会话树数据源</div>}
        <div className="graph-legend">○ 大小 = 消息数</div>
        <button className="graph-reset" title="重置视角（100% + 选中节点居中）" onClick={resetView}>
          ⟳
        </button>
      </div>
    </div>
  );
}
