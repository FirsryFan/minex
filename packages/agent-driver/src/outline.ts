/**
 * 大纲记忆提炼纯函数（task 2-4）：shouldOutline / buildOutlineEntry / toOutlineMarkdown。
 * D2 行式标记协议：`t:` 主题（首条前 20 字）/ `k:` 要点（summary，首条截断 80 字）。
 * 跨包约定：OutlineEntry 形状结构类型本地声明（与 session-driver 2-1 结构一致，跨包零源码 import）。
 */

/** 上下文条目（与 2-1 ContextItem 结构一致） */
export interface ContextItemLike {
  ref: string;
  content: string;
}

/** OutlineEntry 形状（与 session-driver 2-1 的 OutlineEntry 一致，跨包零源码 import） */
export interface OutlineEntryLike {
  id: string;
  ts: string;
  kind: "context" | "lesson" | "fact" | "summary";
  summary: string;
  sourceBranchId?: string;
  sourceNodeIds?: string[];
  payload: string;
}

const SUMMARY_MAX = 80;
const TOPIC_MAX = 20;

/**
 * 提炼判定（v1 简化）：context 非空 + 有实质内容（trim 后非空）即 true。
 * 空 context / 全空内容 → false（不生成条目，不污染大纲）。
 */
export function shouldOutline(contextItems: ContextItemLike[]): boolean {
  return contextItems.some((c) => c.content.trim().length > 0);
}

/** 生成大纲条目（v1）：kind "context"；summary = 首条实质内容截断 80 字；payload = 行式标记 t:/k:。 */
export function buildOutlineEntry(contextItems: ContextItemLike[], now?: string): OutlineEntryLike {
  const first = contextItems.find((c) => c.content.trim().length > 0);
  const content = (first?.content ?? "").trim();
  const summary = content.length > SUMMARY_MAX ? content.slice(0, SUMMARY_MAX) : content;
  const topic = content.slice(0, TOPIC_MAX);
  return {
    id: `o-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    ts: now ?? new Date().toISOString(),
    kind: "context",
    summary,
    sourceNodeIds: contextItems.map((c) => c.ref).filter((r) => r && r !== "parent:tail"),
    payload: `t: ${topic}\nk: ${summary}`,
  };
}

/** 行式标记渲染（上下文面板显示）：payload 逐行；有 sourceBranchId 追加一行。 */
export function toOutlineMarkdown(entry: OutlineEntryLike): string {
  const lines = [entry.payload];
  if (entry.sourceBranchId) lines.push(`branch: ${entry.sourceBranchId}`);
  return lines.join("\n");
}
