import type { ChatMessage, ToolDef } from "./types.js";

/**
 * MessageAssembler（S5b）：S/W/P 三层消息模型。
 * - S 稳定层：system 骨架 + 工具 schema + 早期历史（字节级稳定，缓存友好）
 * - W 工作记忆层：动态状态 / tool_result 加工产物（末尾）
 * - P 参数层：temperature 等（不在 messages）
 *
 * 唯一允许拼 messages 的地方。
 */

/** 对象递归稳定序列化：数组保序，对象键字母序排序（保证 parameters 内部键序稳定）。 */
function stableValue(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableValue).join(",")}]`;
  if (value && typeof value === "object") {
    const keys = Object.keys(value as Record<string, unknown>).sort();
    return `{${keys
      .map((k) => `${JSON.stringify(k)}:${stableValue((value as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

/**
 * 工具定义序列化为固定字段顺序的 JSON，字节级稳定（缓存前缀）。
 * 顶层 name→description→parameters 固定；parameters 内部键递归排序（审查 MAJOR-4）。
 */
export function serializeToolDef(t: ToolDef): string {
  return `{"name":${JSON.stringify(t.name)},"description":${JSON.stringify(t.description)},"parameters":${stableValue(t.parameters)}}`;
}

export interface BuildMessagesInput {
  systemPrompt: string;
  history: ChatMessage[];
  workMemory: ChatMessage[];
}

/**
 * 拼消息：`[system] → history → workMemory`。
 * system/history = S 层（稳定，append-only）；workMemory = W 层（末尾，动态）。
 * 工具 schema 走 `LLMRequest.tools` 参数（不占 message 位，审查 MAJOR-2）；
 * `serializeToolDef` 供需要「工具 schema 稳定序列化」的场景（缓存 key / S5d 工具描述）使用。
 */
export function buildMessages(input: BuildMessagesInput): ChatMessage[] {
  const msgs: ChatMessage[] = [];
  msgs.push({ role: "system", content: input.systemPrompt });
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
