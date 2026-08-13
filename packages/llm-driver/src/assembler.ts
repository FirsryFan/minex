import type { ChatMessage, ToolDef } from "./types.js";

/**
 * MessageAssembler（S5b）：S/W/P 三层消息模型。
 * - S 稳定层：system 骨架 + 工具 schema + 早期历史（字节级稳定，缓存友好）
 * - W 工作记忆层：动态状态 / tool_result 加工产物（末尾）
 * - P 参数层：temperature 等（不在 messages）
 *
 * 唯一允许拼 messages 的地方。
 */

/** 工具定义序列化为固定字段顺序（name→description→parameters）的 JSON，字节级稳定（缓存前缀）。 */
export function serializeToolDef(t: ToolDef): string {
  return JSON.stringify({ name: t.name, description: t.description, parameters: t.parameters });
}

export interface BuildMessagesInput {
  systemPrompt: string;
  tools: ToolDef[];
  history: ChatMessage[];
  workMemory: ChatMessage[];
}

/**
 * 拼消息：`[system] → [tool 序列化描述] → history → workMemory`。
 * system/tools/history = S 层（稳定，append-only）；workMemory = W 层（末尾，动态）。
 */
export function buildMessages(input: BuildMessagesInput): ChatMessage[] {
  const msgs: ChatMessage[] = [];
  msgs.push({ role: "system", content: input.systemPrompt });
  for (const t of input.tools) {
    msgs.push({ role: "tool", content: serializeToolDef(t) });
  }
  msgs.push(...input.history);
  msgs.push(...input.workMemory);
  return msgs;
}

/**
 * 再加工 hook（填充 W 层）：默认透传传入内容。
 * 传入 ChatMessage[] 直接返回；传入 `{ messages }` 返回其 messages；否则空数组。
 */
export function assembleWorkMemory(ctx: unknown): ChatMessage[] {
  if (Array.isArray(ctx)) return ctx as ChatMessage[];
  if (ctx && typeof ctx === "object" && Array.isArray((ctx as { messages?: unknown }).messages)) {
    return (ctx as { messages: ChatMessage[] }).messages;
  }
  return [];
}
