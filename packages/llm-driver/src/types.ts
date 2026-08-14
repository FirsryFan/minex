/** LLM 接入层公共类型（S5a/S5d）。 */

export type ChatRole = "system" | "user" | "assistant" | "tool";

/** 工具调用（role="assistant" 消息的 tool_calls，内部扁平结构：解析/执行用） */
export interface ToolCall {
  id: string;
  name: string;
  /** JSON 字符串 */
  arguments: string;
}

/**
 * 序列化后的 assistant tool_calls（OpenAI/DeepSeek 线格式，紧急修复）：
 * 扁平 ToolCall 发给 DeepSeek 前必须加 `type:"function"` + `function` 包裹，否则 API 400 missing field type。
 * 流式解析侧（deepseek.ts）读回的 delta.tool_calls 也是同形状（{ index, id?, type?, function: { name?, arguments? } }）。
 */
export interface SerializedToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface ChatMessage {
  role: ChatRole;
  content: string;
  /** role="tool" 消息关联的工具调用 id */
  tool_call_id?: string;
  /** role="assistant" 消息发起的工具调用（线格式，发送前必须序列化） */
  tool_calls?: SerializedToolCall[];
}

/** 工具定义（函数 schema） */
export interface ToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface LLMRequest {
  model: string;
  messages: ChatMessage[];
  tools?: ToolDef[];
  params?: Record<string, unknown>;
  stream?: boolean;
  /** 3-4：真停止（AbortController 全链）——fetch 挂 signal，abort → reader.read() 抛 AbortError */
  signal?: AbortSignal;
}

/** 流式工具调用分片（DeepSeek 按 index 分片返回，需累积重组） */
export interface ToolCallDelta {
  index: number;
  id?: string;
  name?: string;
  arguments?: string;
}

/** 流式输出分片：delta 增量文本；done 结束；usage 流末产出；toolCallDelta 工具调用分片 */
export interface LLMChunk {
  delta: string;
  done: boolean;
  usage?: LLMUsage;
  toolCallDelta?: ToolCallDelta;
}

/** 用量统计（DeepSeek 缓存计费字段） */
export interface LLMUsage {
  promptTokens: number;
  completionTokens: number;
  cachedTokens: number;
}

/** LLM Provider 抽象：DeepSeek 先行，Claude/OpenAI/本地模型只换实现 */
export interface LLMProvider {
  stream(req: LLMRequest): AsyncIterable<LLMChunk>;
}
