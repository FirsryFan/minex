/**
 * 通用 Graph 驱动（3-5，id: minex.graph，Q7 定案）：
 * 可交互可视化图 = 通用驱动（与内容无关）；数据经 `graphSource` 贡献提供（注册类型），
 * 任何驱动可 `ctx.register("graphSource", id, src)` 提供任意图（会话树 / 工作流 / 阶段目标图 = 扩展点）。
 * 能力 `graph`（default）：layoutGraph（布局纯函数）+ translateGraph（默认转译器：图→agent 可读 markdown）。
 */
import type { DriverContext } from "@minex/kernel";

export interface GraphNode {
  id: string;
  label: string;
  group?: string;
  /** 自定义数据（大小编码等，如 nodeCount） */
  meta?: Record<string, unknown>;
}

export interface GraphEdge {
  from: string;
  to: string;
  label?: string;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

/** graphSource 贡献形状（title + 数据 + 可选节点点击钩子） */
export interface GraphSource {
  title: string;
  getData(): Promise<GraphData>;
  /** 节点点击钩子（可选；会话树 → emit minex:openSession） */
  onNodeClick?: (node: { id: string; label: string }) => void;
}

/**
 * 树布局（3-5 纯函数）：edges 推 parentId 分层（from = 父，to = 子），
 * 同层按数组序排列；无 edges / 环 / 自指 → fallback 根层（环防御：沿父链走 seen 守卫）。
 */
export function layoutGraph(data: GraphData): Record<string, { x: number; y: number }> {
  const order = new Map(data.nodes.map((n, i) => [n.id, i]));
  const parentOf = new Map<string, string>();
  for (const e of data.edges) parentOf.set(e.to, e.from);

  const depth = new Map<string, number>();
  const computeDepth = (id: string): number => {
    const cached = depth.get(id);
    if (cached !== undefined) return cached;
    let cur = id;
    let d = 0;
    const seen = new Set<string>([id]);
    while (parentOf.has(cur)) {
      const p = parentOf.get(cur)!;
      // 环/自指防御：父链回到已见节点（含自身）→ 本节点视为根（深度 0）断环，不无限递归
      if (p === cur || seen.has(p)) {
        depth.set(id, 0);
        return 0;
      }
      seen.add(cur);
      cur = p;
      d++;
    }
    depth.set(id, d);
    return d;
  };

  const byDepth = new Map<number, string[]>();
  for (const n of data.nodes) {
    const d = computeDepth(n.id);
    const list = byDepth.get(d) ?? [];
    list.push(n.id);
    byDepth.set(d, list);
  }

  const STEP_X = 220;
  const STEP_Y = 160;
  const pos: Record<string, { x: number; y: number }> = {};
  for (const [d, ids] of byDepth) {
    ids.sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
    ids.forEach((id, i) => {
      pos[id] = { x: i * STEP_X, y: d * STEP_Y };
    });
  }
  return pos;
}

/** 默认转译器（3-5）：图 → agent 可读 markdown（节点/边列表）。纯函数可测。 */
export function translateGraph(data: GraphData): string {
  const lines: string[] = ["## 图谱", "### 节点"];
  if (data.nodes.length === 0) lines.push("（无节点）");
  for (const n of data.nodes) {
    lines.push(`- ${n.id}: ${n.label}${n.group ? `（${n.group}）` : ""}`);
  }
  lines.push("### 边");
  if (data.edges.length === 0) lines.push("（无边）");
  for (const e of data.edges) {
    lines.push(`- ${e.from} → ${e.to}${e.label ? `：${e.label}` : ""}`);
  }
  return lines.join("\n");
}

export default {
  async activate(ctx: DriverContext) {
    // graph 能力：布局 + 转译（消费方 = 通用画布面板 / agent graph_query 工具）
    ctx.register("graph", "default", { layoutGraph, translateGraph });

    // 面板：通用可交互画布（graphSource 提供数据，与内容无关）——P2 左栏面板池
    ctx.register("panel", "minex.graph.view", {
      driverId: "minex.graph",
      id: "minex.graph.view",
      title: "图谱",
      defaultDock: "left",
      load: () => import("./graph-view.js"),
    });

    return () => {};
  },
};
