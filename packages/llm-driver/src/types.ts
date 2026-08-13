/** LLM 接入层公共类型（S5a）。 */

export type ChatRole = "system" | "user" | "assistant" | "tool";

export interface ChatMessage {
  role: ChatRole;
  content: string;
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
}

/** 流式输出分片：delta 为增量文本；done 为结束标记 */
export interface LLMChunk {
  delta: string;
  done: boolean;
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
