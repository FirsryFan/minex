import { useEffect, useMemo, useRef, useState } from "react";
import type { MinexKernel } from "@minex/kernel";
import { loadWorkflows, saveWorkflow } from "./workflow-store.js";
import { takePendingEditWorkflowId } from "./workflow-open.js";
import type { ConditionOp, Workflow, WorkflowNode } from "./workflow.js";

/** 白名单 op（operations.ts createBuiltinRegistry 注册的 7 个） */
const WORKFLOW_OPS = [
  "callTool",
  "sendEnvelope",
  "readPool",
  "requestPoolWrite",
  "readSession",
  "writeSession",
  "localVar",
] as const;

const WHEN_OPS: ConditionOp[] = ["eq", "ne", "gt", "gte", "lt", "lte"];

interface WorkflowCap {
  run(wf: Workflow, opts?: { maxLoopIterations?: number }): Promise<Map<string, unknown>>;
  validate(wf: Workflow): void;
}
interface GraphCap {
  layoutGraph(data: {
    nodes: Array<{ id: string }>;
    edges: Array<{ from: string; to: string }>;
  }): Record<string, { x: number; y: number }>;
}

/**
 * Workflow 大型 canvas 编辑器（W-C，主区，agent 驱动）：
 * - 自绘轻量画布：经 graph 能力 layoutGraph 算坐标（.value 纪律，跨包零源码 import）+ 节点卡 +
 *   deps SVG 连线 + CSS transform 缩放/平移/reset（参照 graph-view 交互）；
 * - 点击节点 → 编辑浮层（非拖拽，v1）：op 下拉（白名单 7）/ args JSON / deps 多选（toggle-item）/
 *   when（field+op+value）/ loop 开关 / 删除节点；
 * - 工具栏：＋ 新节点 / 保存（workflow 能力 validate 校验，非法报错不存）/ 运行（run → 底部结果面板）/
 *   返回列表（emit minex:closeWorkflowEditor）；
 * - v1 不做（P2，注释）：拖拽建节点/连线、运行时步骤状态标注（并阶段 4 编排视图）；运行不做权限裁决
 *   （用户显式保存的声明式数据视为用户意图）。
 */
export default function WorkflowEditorView({ kernel, instanceId }: { kernel: MinexKernel; instanceId?: number }) {
  const wfCap = kernel.registry.get<WorkflowCap>("workflow", "default")?.value;
  const graphCap = kernel.registry.get<GraphCap>("graph", "default")?.value;

  const [workflowId, setWorkflowId] = useState<string | null>(null);
  const [wf, setWf] = useState<Workflow | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [nodeDraft, setNodeDraft] = useState<WorkflowNode | null>(null);
  const [argsText, setArgsText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<Map<string, unknown> | null>(null);
  const [transform, setTransform] = useState({ scale: 1, x: 20, y: 20 });

  const containerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null);
  const transformRef = useRef(transform);
  useEffect(() => {
    transformRef.current = transform;
  }, [transform]);

  function open(id: string): void {
    setWorkflowId(id);
    const w = loadWorkflows(kernel)[id] ?? null;
    setWf(w);
    setSelectedId(null);
    setNodeDraft(null);
    setError(null);
    setResults(null);
  }

  useEffect(() => {
    const pending = takePendingEditWorkflowId();
    if (pending) open(pending);
    // 已挂载时切换 workflow（列表单击另一条）
    return kernel.events.on("minex:editWorkflow", (payload) => {
      takePendingEditWorkflowId(); // 已挂载直接处理，丢弃暂存防重复
      const p = payload as { id?: string } | undefined;
      if (p?.id) open(p.id);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kernel]);

  // 画布几何
  const graphData = useMemo(
    () =>
      wf
        ? {
            nodes: wf.nodes.map((n) => ({ id: n.id, label: `${n.id}（${n.op}）` })),
            edges: wf.nodes.flatMap((n) => (n.deps ?? []).map((d) => ({ from: d, to: n.id }))),
          }
        : { nodes: [], edges: [] },
    [wf],
  );
  const layout = useMemo(
    () => (graphCap && wf ? graphCap.layoutGraph(graphData) : {}),
    [graphCap, graphData, wf],
  );
  const CARD_W = 150;
  const CARD_H = 40;
  const lines = useMemo(
    () =>
      wf
        ? wf.nodes.flatMap((n) =>
            (n.deps ?? []).map((d) => {
              const p = layout[d];
              const c = layout[n.id];
              if (!p || !c) return null;
              return { key: `${d}→${n.id}`, x1: p.x + CARD_W / 2, y1: p.y + CARD_H / 2, x2: c.x + CARD_W / 2, y2: c.y + CARD_H / 2 };
            }),
          ).filter((l): l is NonNullable<typeof l> => l !== null)
        : [],
    [wf, layout],
  );
  const worldSize = useMemo(() => {
    if (!wf || wf.nodes.length === 0) return { w: 0, h: 0 };
    const maxX = Math.max(...wf.nodes.map((n) => (layout[n.id]?.x ?? 0) + CARD_W));
    const maxY = Math.max(...wf.nodes.map((n) => (layout[n.id]?.y ?? 0) + CARD_H));
    return { w: maxX + 40, h: maxY + 40 };
  }, [wf, layout]);

  // —— 节点编辑 ——
  function selectNode(id: string): void {
    const n = wf?.nodes.find((x) => x.id === id);
    if (!n) return;
    setSelectedId(id);
    setNodeDraft({ ...n, args: { ...(n.args ?? {}) }, deps: [...(n.deps ?? [])] });
    setArgsText(n.args ? JSON.stringify(n.args, null, 2) : "");
    setError(null);
  }

  function patchDraft(p: Partial<WorkflowNode>): void {
    setNodeDraft((d) => (d ? { ...d, ...p } : d));
  }

  function applyNode(): void {
    if (!nodeDraft || !wf) return;
    let args: Record<string, unknown> | undefined;
    if (argsText.trim() !== "") {
      try {
        const parsed = JSON.parse(argsText);
        if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error("args 须为 JSON 对象");
        args = parsed as Record<string, unknown>;
      } catch (err) {
        setError(`args JSON 非法：${err instanceof Error ? err.message : String(err)}`);
        return;
      }
    }
    const final: WorkflowNode = { ...nodeDraft, ...(args !== undefined ? { args } : {}) };
    setWf((w) => (w ? { ...w, nodes: w.nodes.map((n) => (n.id === final.id ? final : n)) } : w));
    setNodeDraft(null);
    setSelectedId(null);
  }

  function deleteSelectedNode(): void {
    if (!nodeDraft || !wf) return;
    const id = nodeDraft.id;
    setWf((w) =>
      w
        ? {
            ...w,
            nodes: w.nodes.filter((n) => n.id !== id),
          }
        : w,
    );
    setNodeDraft(null);
    setSelectedId(null);
  }

  function addNode(): void {
    if (!wf) return;
    const maxN = wf.nodes.reduce((m, n) => {
      const num = Number(n.id.replace(/^n/, ""));
      return Number.isFinite(num) && num > m ? num : m;
    }, 0);
    const id = `n${maxN + 1}`;
    setWf((w) => (w ? { ...w, nodes: [...w.nodes, { id, op: "localVar" }] } : w));
    setSelectedId(id);
    setNodeDraft({ id, op: "localVar" });
    setArgsText("");
    setError(null);
  }

  // —— 保存 / 运行 ——
  function save(): void {
    if (!wf) return;
    setError(null);
    if (!wfCap) {
      setError("workflow 能力不可用");
      return;
    }
    try {
      wfCap.validate(wf); // 非法 op/deps/when/loop 上限 → 抛错
      if (workflowId) {
        saveWorkflow(kernel, workflowId, wf);
        kernel.events.emit("minex:dataChanged", { driverId: "minex.agent" }); // 图谱/列表联动
      }
    } catch (err) {
      setError(`校验失败，未保存：${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async function run(): Promise<void> {
    if (!wf || !wfCap) return;
    setError(null);
    try {
      const out = await wfCap.run(wf, { maxLoopIterations: 100 });
      setResults(out);
    } catch (err) {
      setError(`运行失败：${err instanceof Error ? err.message : String(err)}`);
    }
  }

  function closeEditor(): void {
    kernel.events.emit("minex:closeWorkflowEditor", { targetInstanceId: instanceId });
  }

  // 画布交互
  function onPointerDown(e: React.PointerEvent): void {
    if ((e.target as Element).closest(".wf-node")) return;
    dragRef.current = { sx: e.clientX, sy: e.clientY, ox: transformRef.current.x, oy: transformRef.current.y };
  }
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

  return (
    <div className="wf-editor">
      <div className="wf-toolbar">
        <span className="muted">{workflowId ?? "（未打开）"}</span>
        <button className="btn-ghost" onClick={addNode}>＋ 新节点</button>
        <button className="btn-ghost" onClick={save}>保存</button>
        <button className="btn" onClick={() => void run()}>运行</button>
        {error && <span className="wf-error">{error}</span>}
        <button className="btn-ghost wf-back" onClick={closeEditor}>返回列表</button>
      </div>

      <div className="wf-canvas" ref={containerRef} onWheel={onWheel} onPointerDown={onPointerDown}>
        {(!wf || wf.nodes.length === 0) && <div className="muted wf-empty">（空 workflow，点 ＋ 新节点开始）</div>}
        {wf && worldSize.w > 0 && (
          <div
            className="wf-world"
            style={{
              width: worldSize.w,
              height: worldSize.h,
              transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
              transformOrigin: "0 0",
            }}
          >
            <svg className="wf-lines" width={worldSize.w} height={worldSize.h}>
              {lines.map((l) => (
                <line key={l.key} x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} />
              ))}
            </svg>
            {wf.nodes.map((n) => {
              const p = layout[n.id];
              if (!p) return null;
              return (
                <div
                  key={n.id}
                  className={`wf-node${selectedId === n.id ? " selected" : ""}`}
                  style={{ left: p.x, top: p.y, width: CARD_W, height: CARD_H }}
                  onClick={() => selectNode(n.id)}
                  title="点击编辑节点"
                >
                  <div className="wf-node-id">{n.id}</div>
                  <div className="wf-node-op">{n.op}</div>
                </div>
              );
            })}
          </div>
        )}
        <button className="graph-reset" title="重置视角" onClick={() => setTransform({ scale: 1, x: 20, y: 20 })}>
          ⟳
        </button>
      </div>

      {/* 节点编辑浮层 */}
      {nodeDraft && (
        <div className="floating-mask" onClick={() => { setNodeDraft(null); setSelectedId(null); }}>
          <div className="wf-node-editor" onClick={(e) => e.stopPropagation()}>
            <div className="section-title">节点：{nodeDraft.id}</div>
            <div className="field">
              <label>op（白名单）</label>
              <div className="field-control">
                <select value={nodeDraft.op} onChange={(e) => patchDraft({ op: e.target.value })}>
                  {WORKFLOW_OPS.map((o) => (
                    <option key={o} value={o}>{o}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="field">
              <label>args（JSON）</label>
              <div className="field-control">
                <textarea rows={5} value={argsText} onChange={(e) => setArgsText(e.target.value)} placeholder="{}" />
              </div>
            </div>
            <div className="field">
              <label>deps（前置节点，多选）</label>
              <div className="field-control">
                {wf?.nodes.filter((x) => x.id !== nodeDraft.id).map((x) => {
                  const on = (nodeDraft.deps ?? []).includes(x.id);
                  return (
                    <div
                      key={x.id}
                      className={`toggle-item${on ? " on" : ""}`}
                      role="button"
                      onClick={() =>
                        patchDraft({
                          deps: on
                            ? (nodeDraft.deps ?? []).filter((d) => d !== x.id)
                            : [...(nodeDraft.deps ?? []), x.id],
                        })
                      }
                    >
                      <div className="toggle-item-main">
                        <div className="toggle-item-name">{x.id}</div>
                        <div className="toggle-item-desc">{x.op}</div>
                      </div>
                      <button className={`toggle${on ? " on" : ""}`} aria-label={x.id} />
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="field">
              <label>when（条件）</label>
              <div className="field-control">
                <div style={{ display: "flex", gap: 4 }}>
                  <input
                    placeholder="field（节点 id）"
                    value={nodeDraft.when?.field ?? ""}
                    onChange={(e) => patchDraft({ when: { field: e.target.value, op: nodeDraft.when?.op ?? "eq", value: nodeDraft.when?.value } })}
                  />
                  <select
                    value={nodeDraft.when?.op ?? "eq"}
                    onChange={(e) => patchDraft({ when: { field: nodeDraft.when?.field ?? "", op: e.target.value as ConditionOp, value: nodeDraft.when?.value } })}
                  >
                    {WHEN_OPS.map((o) => (
                      <option key={o} value={o}>{o}</option>
                    ))}
                  </select>
                  <input
                    placeholder="value"
                    value={nodeDraft.when?.value !== undefined ? String(nodeDraft.when.value) : ""}
                    onChange={(e) => patchDraft({ when: { field: nodeDraft.when?.field ?? "", op: nodeDraft.when?.op ?? "eq", value: e.target.value } })}
                  />
                </div>
                <button className="btn-ghost" onClick={() => patchDraft({ when: undefined })}>清除 when</button>
              </div>
            </div>
            <div className="field">
              <label>loop</label>
              <div className="field-control">
                <div
                  className={`toggle-item${nodeDraft.loop ? " on" : ""}`}
                  role="button"
                  onClick={() => patchDraft({ loop: !nodeDraft.loop })}
                >
                  <div className="toggle-item-main">
                    <div className="toggle-item-name">循环节点</div>
                    <div className="toggle-item-desc">需要 maxLoopIterations 上限（运行校验）</div>
                  </div>
                  <button className={`toggle${nodeDraft.loop ? " on" : ""}`} aria-label="loop" />
                </div>
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 10 }}>
              <button className="btn-ghost wf-del" onClick={deleteSelectedNode}>删除节点</button>
              <button className="btn-ghost" onClick={() => { setNodeDraft(null); setSelectedId(null); }}>取消</button>
              <button className="btn" onClick={applyNode}>应用</button>
            </div>
          </div>
        </div>
      )}

      {/* 运行结果面板 */}
      {results && (
        <div className="wf-results">
          <div className="section-title">运行结果</div>
          {[...results.entries()].map(([id, v]) => (
            <div key={id} className="wf-result-row">
              <span className="wf-result-id">{id}</span>
              <span className="muted">{String(v ?? "")}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
