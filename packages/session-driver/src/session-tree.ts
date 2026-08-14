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
  for (const id of branch.nodeIds.slice(-tailCount)) {
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
