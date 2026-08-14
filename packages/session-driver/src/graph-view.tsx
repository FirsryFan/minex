import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MinexKernel } from "@minex/kernel";
import { buildSessionGraph, layoutSessionGraph, type SessionGraph } from "./session-tree.js";
import type { Session } from "./session.js";
import type { SessionStore } from "./store.js";

const NODE_W = 56; // G-A 反馈 4：圆形节点（直径 56，中心 = +28）
const NODE_H = 56;

type Tab = "graph" | "outline";

/**
 * 会话系面板（task 2-R2，P2/P3）：左栏，两个 icon tab（图谱 / 大纲，不用文字——驱动不引 lucide，用字形图标）。
 * - 图谱 tab：buildSessionGraph（推导不存文件）+ layoutSessionGraph → 会话卡片树形布局；当前会话默认居中；
 *   wheel 缩放（鼠标锚点）+ pointer 拖拽平移 + reset（100% + 当前会话居中）；节点点击 → minex:openSession。
 * - 大纲 tab：当前会话 meta.outlines（summary + kind 徽标），点击条目「加入上下文」选中高亮。
 */
export default function GraphView({ kernel, instanceId }: { kernel: MinexKernel; instanceId?: number }) {
  // .value 纪律：registry.get 返回 Contribution，能力值在 .value
  const store = kernel.registry.get<SessionStore>("session", "default")?.value;

  const [tab, setTab] = useState<Tab>("graph");
  const [graph, setGraph] = useState<SessionGraph | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [outlineSel, setOutlineSel] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null); // R-A 反馈 3：节点删除确认
  const [hoverId, setHoverId] = useState<string | null>(null); // G-A 反馈 4：hover 信息栏
  const [transform, setTransform] = useState({ scale: 1, x: 0, y: 0 });

  const containerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null);
  const centeredRef = useRef(false); // 反馈 3：初始居中只做一次，后续数据刷新不抢视角
  const transformRef = useRef(transform);
  useEffect(() => {
    transformRef.current = transform;
  }, [transform]);

  // 数据：索引 + 各会话 meta（parentSessionId）→ 图谱推导；当前会话默认 = 索引第一个（loadIndex 按 updatedAt 降序）
  const refresh = useCallback(async (): Promise<void> => {
    if (!store) return;
    const index = await store.loadIndex();
    const loaded = await Promise.all(index.sessions.map((e) => store.loadSession(e.id)));
    const ok = loaded.filter((s): s is Session => Boolean(s));
    setSessions(ok);
    setGraph(buildSessionGraph(index.sessions, (id) => ok.find((s) => s.meta.id === id)?.meta));
    // 反馈 3：刷新不得覆盖用户选中的会话（否则点击子会话会被 refresh 闪回索引首位=主会话）；
    // 仅首次（null）或选中项已被删除时回落到索引首位。
    setCurrentSessionId((cur) => {
      if (cur === null) return index.sessions[0]?.id ?? null;
      return index.sessions.some((e) => e.id === cur) ? cur : (index.sessions[0]?.id ?? null);
    });
  }, [store]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // R-A 反馈 2：订阅刷新（保存/新建/删除会话后图谱立即更新，无需重开面板；订阅卸载清理）。
  // 反馈 3：不再订阅 minex:openSession——openSession 是本面板节点点击自己 emit 的事件，
  // 订阅它会形成「点击 → emit → refresh → 覆盖选中/重算图 → 初始居中 effect 再把视角拉回根」的闪退链；
  // 数据新鲜度已由 registry.onChange + minex:dataChanged（store 所有保存/删除路径统一 emit）覆盖。
  useEffect(() => {
    const offs: Array<() => void> = [];
    offs.push(kernel.registry.onChange("*", () => void refresh()));
    offs.push(kernel.events.on("minex:dataChanged", () => void refresh()));
    return () => offs.forEach((off) => off());
  }, [kernel, refresh]);

  const currentSession = sessions.find((s) => s.meta.id === currentSessionId) ?? null;
  const outlines = currentSession?.meta.outlines ?? [];
  // G-A 反馈 4：hover 信息栏（悬停优先，否则当前会话）
  const hovered = sessions.find((s) => s.meta.id === (hoverId ?? currentSessionId)) ?? null;

  // 图谱布局（纯函数）与画布世界尺寸 / 父子连线
  const layout = useMemo(() => (graph ? layoutSessionGraph(graph) : {}), [graph]);
  const worldSize = useMemo(() => {
    if (!graph || graph.nodes.length === 0) return { w: 0, h: 0 };
    const maxX = Math.max(...graph.nodes.map((n) => (layout[n.id]?.x ?? 0) + NODE_W));
    const maxY = Math.max(...graph.nodes.map((n) => (layout[n.id]?.y ?? 0) + NODE_H));
    return { w: maxX + 40, h: maxY + 40 };
  }, [graph, layout]);
  const lines = useMemo(() => {
    if (!graph) return [];
    const out: Array<{ x1: number; y1: number; x2: number; y2: number }> = [];
    for (const n of graph.nodes) {
      if (!n.parentId) continue;
      const p = layout[n.parentId];
      const c = layout[n.id];
      if (!p || !c) continue;
      out.push({ x1: p.x + NODE_W / 2, y1: p.y + NODE_H / 2, x2: c.x + NODE_W / 2, y2: c.y + NODE_H / 2 });
    }
    return out;
  }, [graph, layout]);

  /** 把节点置于画布中心（scale 指定）：屏幕 = 世界 × scale + translate */
  function centerOn(id: string | null, scale: number): void {
    const box = containerRef.current;
    const vw = box?.clientWidth ?? 400;
    const vh = box?.clientHeight ?? 300;
    const p = id ? layout[id] : undefined;
    setTransform({
      scale,
      x: vw / 2 - ((p?.x ?? 0) + NODE_W / 2) * scale,
      y: vh / 2 - ((p?.y ?? 0) + NODE_H / 2) * scale,
    });
  }

  // 打开时当前会话默认居中 + 缩放适应（单节点 1.2 / 多节点 0.9）。
  // 反馈 3：只做一次（centeredRef 守卫）——后续数据刷新（minex:dataChanged → 重算图）不得把用户
  // 点击/拖拽/缩放后的视角抢回 0.9/1.2；点击会话的居中由 openSession 显式 centerOn(id, 1) 承担。
  // checker minor：空图时重臂守卫——删空全部会话后新建首个会话，仍能以新会话为中心（而非左上角）。
  useEffect(() => {
    if (graph && graph.nodes.length > 0 && !centeredRef.current) {
      centeredRef.current = true;
      centerOn(currentSessionId, graph.nodes.length <= 1 ? 1.2 : 0.9);
    } else if (graph && graph.nodes.length === 0) {
      centeredRef.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph]);

  // 拖拽平移：window pointer 监听（canvas 背景按下开始；节点按下不拖，走点击）
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

  /** wheel 缩放：以鼠标为锚点（保持鼠标下的内容点不动） */
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

  /** reset：100% + 当前会话居中（RotateCcw 语义，字形 ⟳） */
  function resetView(): void {
    centerOn(currentSessionId, 1);
  }

  /** 节点点击 → 打开会话对话模式（复用 2-2 入口）+ G-A 反馈 3：视角跟随（该会话置于视图中心 1 倍） */
  function openSession(id: string): void {
    setCurrentSessionId(id);
    centerOn(id, 1);
    kernel.events.emit("minex:openSession", { id, targetInstanceId: instanceId });
  }

  /** R-A 反馈 3：节点删除（确认后 deleteSession + 刷新；删父会话后子会话变根——buildSessionGraph 对 parent 不存在按根排） */
  async function confirmDelete(): Promise<void> {
    if (!store || !deleteId) return;
    await store.deleteSession(deleteId);
    setDeleteId(null);
    await refresh();
  }

  return (
    <div className="graph-view">
      <div className="graph-tabs">
        <button className={`graph-tab${tab === "graph" ? " active" : ""}`} title="图谱" onClick={() => setTab("graph")}>
          🕸
        </button>
        <button className={`graph-tab${tab === "outline" ? " active" : ""}`} title="大纲" onClick={() => setTab("outline")}>
          ☰
        </button>
      </div>

      {tab === "graph" ? (
        <div className="graph-canvas" ref={containerRef} onWheel={onWheel} onPointerDown={onPointerDown}>
          {/* G-A 反馈 4：顶部 hover 信息栏（悬停某圆显示其信息，无悬停显示当前会话） */}
          <div className="graph-info">
            {hovered ? (
              <>
                <span className="graph-info-title">{hovered.meta.title}</span>
                <span className="muted">
                  {hovered.nodes.length} 消息
                  {hovered.meta.tags.length > 0 ? ` · ${hovered.meta.tags.join(" ")}` : ""}
                  {` · ${hovered.meta.updatedAt.slice(0, 10)}`}
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
                {lines.map((l, i) => (
                  <line key={i} x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} />
                ))}
              </svg>
              {graph?.nodes.map((n) => {
                const p = layout[n.id];
                if (!p) return null;
                return (
                  <div
                    key={n.id}
                    className={`graph-node${n.id === currentSessionId ? " current" : ""}${hoverId === n.id ? " hover" : ""}`}
                    style={{ left: p.x, top: p.y, width: NODE_W, height: NODE_H }}
                    onClick={() => openSession(n.id)}
                    onMouseEnter={() => setHoverId(n.id)}
                    onMouseLeave={() => setHoverId(null)}
                    title={`打开「${n.title}」`}
                  >
                    <button
                      className="graph-node-del"
                      title="删除会话"
                      onClick={(e) => {
                        e.stopPropagation();
                        setDeleteId(n.id);
                      }}
                    >
                      ✕
                    </button>
                    <span className="graph-node-char">{n.title.slice(0, 1)}</span>
                  </div>
                );
              })}
            </div>
          )}
          {graph && graph.nodes.length === 0 && <div className="muted graph-empty">（暂无会话）</div>}
          <button className="graph-reset" title="重置视角（100% + 当前会话居中）" onClick={resetView}>
            ⟳
          </button>
        </div>
      ) : (
        <div className="graph-outline">
          {outlines.length === 0 && <div className="muted graph-empty">（当前会话暂无大纲）</div>}
          {outlines.map((o) => (
            <button
              key={o.id}
              className={`graph-outline-item${outlineSel === o.id ? " selected" : ""}`}
              onClick={() => setOutlineSel((s) => (s === o.id ? null : o.id))}
              title="加入上下文（选中高亮，供子对话继承）"
            >
              <span className="graph-outline-kind">{o.kind}</span>
              <span>{o.summary}</span>
            </button>
          ))}
        </div>
      )}

      {/* R-A 反馈 3：删除确认（ConfirmModal 模式） */}
      {deleteId && (
        <div className="floating-mask" onClick={() => setDeleteId(null)}>
          <div className="confirm-box" onClick={(e) => e.stopPropagation()}>
            <p>确定删除该会话？此操作不可撤销。</p>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 12 }}>
              <button className="btn-ghost" onClick={() => setDeleteId(null)}>取消</button>
              <button className="btn" onClick={() => void confirmDelete()}>删除</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
