/**
 * 会话树纯函数库 + 大纲记忆数据结构（task 2-1，阶段 2「记得住」第 1 步）。
 * D7/D8/D4 定案：分支推导/切换/删除/上下文构建全部纯函数，UI 只消费；分支指针不落盘、纯函数推导（教训 #30）。
 * 会话 = 交互场所（announcements 概念澄清）；大纲记忆 = 附在 session.meta 的短期记忆条目。
 */

import type { Session, SessionLink, SessionNode } from "./session.js";

/** 分支：id = 分支入口节点 id（主链恒为 "main"）；沿 responds 链收集节点序列（chronological） */
export interface Branch {
  id: string;
  entryNodeId: string;
  nodeIds: string[];
  headNodeId: string;
}

/** 上下文条目（供 LLM history / 大纲提炼消费；session-driver 不依赖 llm-driver） */
export interface ContextItem {
  /** 显式引用 = 节点 id；父链尾部自动上下文 = "parent:tail" 标记 */
  ref: string;
  content: string;
}

/** 大纲记忆条目（D4 Envelope 式：固定骨架必填 + 可选字段 + payload 自由载体） */
export interface OutlineEntry {
  id: string;
  ts: string;
  kind: "context" | "lesson" | "fact" | "summary";
  summary: string;
  sourceBranchId?: string;
  sourceNodeIds?: string[];
  payload: string;
}

export interface BuildContextOptions {
  /** 显式引用（框选）的节点 id；按链中顺序输出，不在链上的忽略 */
  selectedNodeIds?: string[];
  /** 尾部补全条数（默认 10） */
  tailCount?: number;
}

const OUTLINE_KINDS = ["context", "lesson", "fact", "summary"] as const;

/** 校验 OutlineEntry 形状（validateSession 复用）：骨架必填字段全检查，payload 任意字符串可存。 */
export function validateOutlineEntry(data: unknown): data is OutlineEntry {
  if (typeof data !== "object" || data === null) return false;
  const e = data as Record<string, unknown>;
  if (typeof e.id !== "string" || typeof e.ts !== "string") return false;
  if (typeof e.kind !== "string" || !(OUTLINE_KINDS as readonly string[]).includes(e.kind)) return false;
  if (typeof e.summary !== "string" || typeof e.payload !== "string") return false;
  if (e.sourceBranchId !== undefined && typeof e.sourceBranchId !== "string") return false;
  if (
    e.sourceNodeIds !== undefined &&
    (!Array.isArray(e.sourceNodeIds) || (e.sourceNodeIds as unknown[]).some((x) => typeof x !== "string"))
  ) {
    return false;
  }
  return true;
}

/**
 * 推导分支：主链 = 无 responds 前驱且无 branch 入边的根节点链（id "main"）；
 * 每个 branch 链接的 to 节点 = 分支入口，沿 responds 链（to → from）收集节点序列；
 * headNodeId = 链末端（无 responds 出边，即最新节点）。空会话 → []。
 */
export function deriveBranches(session: Session): Branch[] {
  // 有 responds 前驱 = 出现在 responds 链接的 from（该节点回应了某人）；无前驱 = 根
  const respondsFrom = new Set(session.links.filter((l) => l.type === "responds").map((l) => l.from));
  const branchIn = new Set(session.links.filter((l) => l.type === "branch").map((l) => l.to));

  /** 从入口沿 responds 前向链收集节点序列（含入口），末端即 head */
  function collectChain(entryNodeId: string): string[] {
    const chain: string[] = [entryNodeId];
    let current = entryNodeId;
    for (;;) {
      const next = session.links.find((l) => l.type === "responds" && l.to === current);
      if (!next) break;
      current = next.from;
      chain.push(current);
    }
    return chain;
  }

  const branches: Branch[] = [];
  // 主链：无 responds 前驱（根）且无 branch 入边的节点（取第一个）
  const mainEntry = session.nodes.find((n) => !respondsFrom.has(n.id) && !branchIn.has(n.id));
  if (mainEntry) {
    const chain = collectChain(mainEntry.id);
    branches.push({ id: "main", entryNodeId: mainEntry.id, nodeIds: chain, headNodeId: chain[chain.length - 1] });
  }
  // 分支入口按节点顺序稳定输出
  for (const n of session.nodes) {
    if (!branchIn.has(n.id)) continue;
    const chain = collectChain(n.id);
    branches.push({ id: n.id, entryNodeId: n.id, nodeIds: chain, headNodeId: chain[chain.length - 1] });
  }
  return branches;
}

/**
 * 切换分支（不可变）：meta.currentBranchId = branchId；branchId 不存在 → 抛错。
 * 分支指针不落盘，纯函数推导（checkout 只改当前视图指针，不刷新 updatedAt——视图切换非内容变更）。
 */
export function checkout(session: Session, branchId: string): Session {
  if (!deriveBranches(session).some((b) => b.id === branchId)) {
    throw new Error(`分支不存在：${branchId}`);
  }
  return { ...session, meta: { ...session.meta, currentBranchId: branchId } };
}

/**
 * 删除分支（git 三规则，不可变）：
 * ① currentBranchId === branchId → error「当前分支不可删除，请先切换」；
 * ② 有其他 branch 链接从本分支节点分叉（被引用）→ error「有分支基于此分叉，不可删除」+ 列出引用者；
 * ③ 孤儿分支 → 删该分支全部节点 + 关联链接（responds/branch 均清）。
 * 分支不存在 → error（不抛错，UI 友好）。
 */
export function deleteBranch(session: Session, branchId: string): { session: Session; error?: string } {
  const branch = deriveBranches(session).find((b) => b.id === branchId);
  if (!branch) return { session, error: `分支不存在：${branchId}` };
  if (session.meta.currentBranchId === branchId) {
    return { session, error: "当前分支不可删除，请先切换" };
  }
  // 被引用：branch 链接的 from 在本分支节点内 = 有子分支基于此分叉
  const forked = session.links.filter((l) => l.type === "branch" && branch.nodeIds.includes(l.from));
  if (forked.length > 0) {
    return { session, error: `有分支基于此分叉，不可删除：${forked.map((l) => l.to).join("、")}` };
  }
  const nodeSet = new Set(branch.nodeIds);
  return {
    session: {
      ...session,
      nodes: session.nodes.filter((n) => !nodeSet.has(n.id)),
      links: session.links.filter((l) => !nodeSet.has(l.from) && !nodeSet.has(l.to)),
      meta: { ...session.meta, updatedAt: new Date().toISOString() },
    },
  };
}

function nodeContent(n: SessionNode): string {
  if (n.kind === "tool" && n.output !== undefined) return String(n.output);
  return n.content ?? "";
}

/**
 * 构建上下文（供 LLM history / 大纲提炼）：
 * 先按 selectedNodeIds 收集显式引用（按链中顺序，ref = 节点 id；不在链上的忽略），
 * 再补该分支链末端最近 tailCount（默认 10）条（ref = "parent:tail"），内容级去重（显式优先）。
 * branchId 不存在 → 抛错（与 checkout 一致）。
 */
export function buildContext(session: Session, branchId: string, opts: BuildContextOptions = {}): ContextItem[] {
  const branch = deriveBranches(session).find((b) => b.id === branchId);
  if (!branch) throw new Error(`分支不存在：${branchId}`);
  const byId = new Map(session.nodes.map((n) => [n.id, n]));

  const items: ContextItem[] = [];
  const seen = new Set<string>(); // 按内容去重（显式优先：先加显式，尾部重复跳过）
  const add = (ref: string, content: string): void => {
    if (content === "" || seen.has(content)) return;
    seen.add(content);
    items.push({ ref, content });
  };

  const chainOrder = new Map(branch.nodeIds.map((id, i) => [id, i]));
  const selected = (opts.selectedNodeIds ?? [])
    .filter((id) => chainOrder.has(id))
    .sort((a, b) => (chainOrder.get(a) ?? 0) - (chainOrder.get(b) ?? 0));
  for (const id of selected) {
    const n = byId.get(id);
    if (n) add(id, nodeContent(n));
  }

  const tailCount = opts.tailCount ?? 10;
  // G-B 反馈 7 真根因修复：slice(-0) === slice(0) 返回整个数组——0/负值必须显式分支为空 tail
  const tail = tailCount > 0 ? branch.nodeIds.slice(-tailCount) : [];
  for (const id of tail) {
    const n = byId.get(id);
    if (n) add("parent:tail", nodeContent(n));
  }
  return items;
}

/** 追加大纲记忆（不可变）：同 id 去重（保留首条）；刷新 updatedAt。 */
export function addOutlineEntry(session: Session, entry: OutlineEntry): Session {
  const outlines = session.meta.outlines ?? [];
  if (outlines.some((o) => o.id === entry.id)) return session;
  return {
    ...session,
    meta: { ...session.meta, outlines: [...outlines, entry], updatedAt: new Date().toISOString() },
  };
}

/** 列出大纲记忆：kind 过滤（缺省全部）；返回副本。 */
export function listOutlines(session: Session, kind?: OutlineEntry["kind"]): OutlineEntry[] {
  const outlines = session.meta.outlines ?? [];
  return kind ? outlines.filter((o) => o.kind === kind) : [...outlines];
}

/** 会话系图谱（P3 拍板：推导不存文件，权威数据 = 各会话 meta.parentSessionId） */
export interface SessionGraphNode {
  id: string;
  title: string;
  nodeCount: number;
  /** 父会话 id（根节点无） */
  parentId?: string;
}

export interface SessionGraph {
  nodes: SessionGraphNode[];
}

/** 索引条目最小结构（buildSessionGraph 只读 id/title/nodeCount；数组序 = 创建序代理） */
export interface SessionGraphSource {
  id: string;
  title: string;
  nodeCount: number;
}

/** 会话 meta 最小结构（loadMeta 只读 parentSessionId） */
export interface SessionMetaLike {
  parentSessionId?: string;
}

/**
 * 构建会话系图谱：扫描索引 + 读各会话 meta.parentSessionId 聚合。
 * - parentId 指向不存在会话（父已删）/ 指向自己 → 不建边（孤立根）；
 * - **环状防御**：parentId 成环时按创建序断环（数组序为创建序代理，断「较晚创建」节点的入边）→ 无无限循环。
 */
export function buildSessionGraph(
  index: SessionGraphSource[],
  loadMeta: (id: string) => SessionMetaLike | undefined,
): SessionGraph {
  const byId = new Set(index.map((e) => e.id));
  const edges = new Map<string, string>(); // childId → parentId
  for (const e of index) {
    const pid = loadMeta(e.id)?.parentSessionId;
    if (pid && pid !== e.id && byId.has(pid)) edges.set(e.id, pid);
  }
  breakCycles(edges, index);
  return {
    nodes: index.map((e) => {
      const pid = edges.get(e.id);
      return { id: e.id, title: e.title, nodeCount: e.nodeCount, ...(pid ? { parentId: pid } : {}) };
    }),
  };
}

/** 找环：沿 parent 链走，节点重复即环（返回环上节点序列，child 序） */
function findCycle(edges: Map<string, string>): string[] | null {
  for (const start of edges.keys()) {
    const path: string[] = [];
    const pos = new Map<string, number>();
    let cur: string | undefined = start;
    while (cur !== undefined && edges.has(cur)) {
      if (pos.has(cur)) return path.slice(pos.get(cur)!);
      pos.set(cur, path.length);
      path.push(cur);
      cur = edges.get(cur);
    }
  }
  return null;
}

/** 反复断环：环上「数组序最晚」的节点入边删除（较晚创建的节点视为环的成因），直到无环 */
function breakCycles(edges: Map<string, string>, index: SessionGraphSource[]): void {
  const order = new Map(index.map((e, i) => [e.id, i]));
  for (;;) {
    const cycle = findCycle(edges);
    if (!cycle) return;
    const latest = cycle.reduce((a, b) => ((order.get(b) ?? 0) > (order.get(a) ?? 0) ? b : a));
    edges.delete(latest);
  }
}

/**
 * 简单树布局：按 parentId 分层（根层 0、深度 +1），同层按数组序排列；
 * 返回 nodeId → {x, y}（x = 同层索引 × STEP_X，y = 深度 × STEP_Y）。无环（buildSessionGraph 已断环）。
 */
export function layoutSessionGraph(graph: SessionGraph): Record<string, { x: number; y: number }> {
  const order = new Map(graph.nodes.map((n, i) => [n.id, i]));
  const depth = new Map<string, number>();
  const computeDepth = (id: string): number => {
    const cached = depth.get(id);
    if (cached !== undefined) return cached;
    const node = graph.nodes.find((n) => n.id === id);
    if (!node || node.parentId === undefined) return 0;
    const d = computeDepth(node.parentId) + 1;
    depth.set(id, d);
    return d;
  };
  const byDepth = new Map<number, string[]>();
  for (const n of graph.nodes) {
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
