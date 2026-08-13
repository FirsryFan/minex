import type {
  ChatMessage,
  LLMChunk,
  LLMMetricsEntry,
  LLMPrices,
  LLMRequest,
  LLMUsage,
  ToolCall,
  ToolCallDelta,
  ToolDef,
} from "minex-llm-driver";
import { buildMessages, computeCost, computeHitRate } from "minex-llm-driver";
import type { AgentTool } from "./tool.js";

/** agent loop 事件（流式） */
export type AgentEvent =
  | { kind: "text"; delta: string }
  | { kind: "toolCall"; name: string; args: unknown }
  | { kind: "done"; usage?: LLMUsage }
  | { kind: "error"; message: string };

export interface RunAgentOptions {
  systemPrompt: string;
  history: ChatMessage[];
  maxIterations?: number;
  /** 再加工 hook（W 层）：工具结果回灌前加工，默认透传 */
  rework?: (result: ChatMessage) => ChatMessage[];
}

export interface AgentDeps {
  /** llm 能力（Provider.stream） */
  stream(req: LLMRequest): AsyncIterable<LLMChunk>;
  /** 工具列表 */
  tools: AgentTool[];
  /** 默认模型名 */
  model: string;
  /** 计量记录 */
  recordMetrics(entry: LLMMetricsEntry): void;
  /** 价格表（每 1M token 美元） */
  prices: LLMPrices;
}

/** 累积的流式响应（供 parseAssistantResponse 解析） */
export interface AccumulatedResponse {
  content: string;
  toolCallDeltas: ToolCallDelta[];
}

/**
 * 解析累积的完整响应 → 文本 + 工具调用（分片按 index 重组）。纯函数可测。
 */
export function parseAssistantResponse(payload: AccumulatedResponse): { text: string; toolCalls: ToolCall[] } {
  const acc = new Map<number, ToolCall>();
  for (const d of payload.toolCallDeltas) {
    let cur = acc.get(d.index);
    if (!cur) {
      cur = { id: "", name: "", arguments: "" };
      acc.set(d.index, cur);
    }
    if (d.id !== undefined) cur.id = d.id;
    if (d.name !== undefined) cur.name = d.name;
    if (d.arguments !== undefined) cur.arguments += d.arguments;
  }
  const toolCalls = [...acc.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, c]) => c)
    .filter((c) => c.id !== "" && c.name !== ""); // 防御：缺 id/name 的分片重组视为异常，丢弃避免 API 400（审查 MINOR-2）
  return { text: payload.content, toolCalls };
}

/** 构造工具结果消息（role="tool" + tool_call_id + content）。纯函数可测。 */
export function buildToolResultMessage(toolCallId: string, result: string): ChatMessage {
  return { role: "tool", content: result, tool_call_id: toolCallId };
}

/** 默认再加工 hook：透传（返回 [toolResult]）。 */
export function defaultRework(result: ChatMessage): ChatMessage[] {
  return [result];
}

/**
 * ReAct agent loop（串行）：LLM 决策 → 工具调用 → 结果回灌 → 再循环，直到无 tool_call 或达上限。
 * 产出 AgentEvent 流。
 */
export async function* runAgent(deps: AgentDeps, opts: RunAgentOptions): AsyncIterable<AgentEvent> {
  const maxIterations = Math.max(1, opts.maxIterations ?? 10); // 防呆：≤0 时至少 1 次迭代（审查 MINOR-3）
  const rework = opts.rework ?? defaultRework;
  const tools: ToolDef[] = deps.tools.map((t) => ({
    name: t.name,
    description: t.description,
    parameters: t.parameters,
  }));
  const byName = new Map(deps.tools.map((t) => [t.name, t]));

  const history: ChatMessage[] = [...opts.history];
  let finalUsage: LLMUsage | undefined;

  for (let i = 0; i < maxIterations; i++) {
    const started = Date.now();
    const messages = buildMessages({ systemPrompt: opts.systemPrompt, history, workMemory: [] });
    const acc: AccumulatedResponse = { content: "", toolCallDeltas: [] };
    let ttftMs = 0;
    let first = true;

    try {
      for await (const chunk of deps.stream({ model: deps.model, messages, tools, stream: true })) {
        if (first && (chunk.delta || chunk.toolCallDelta)) {
          ttftMs = Date.now() - started; // 首个分片（文本或工具调用）即计 ttft（审查 MINOR-1）
          first = false;
        }
        if (chunk.delta) {
          acc.content += chunk.delta;
          yield { kind: "text", delta: chunk.delta };
        }
        if (chunk.toolCallDelta) {
          acc.toolCallDeltas.push(chunk.toolCallDelta);
        }
        if (chunk.done) {
          finalUsage = chunk.usage;
          break;
        }
      }
    } catch (err) {
      yield { kind: "error", message: err instanceof Error ? err.message : String(err) };
      return;
    }

    const { text, toolCalls } = parseAssistantResponse(acc);

    // 计量：stream 结束记录
    if (finalUsage) {
      const totalMs = Date.now() - started;
      deps.recordMetrics({
        model: deps.model,
        promptTokens: finalUsage.promptTokens,
        completionTokens: finalUsage.completionTokens,
        cachedTokens: finalUsage.cachedTokens,
        ttftMs,
        totalMs,
        cost: computeCost(finalUsage, deps.prices),
        hitRate: computeHitRate(finalUsage.cachedTokens, finalUsage.promptTokens),
      });
    }

    // 无工具调用 → 结束（产出 done + usage）
    if (toolCalls.length === 0) {
      // 回灌 assistant 文本
      history.push({ role: "assistant", content: text });
      yield { kind: "done", usage: finalUsage };
      return;
    }

    // 回灌 assistant（带 tool_calls）
    history.push({ role: "assistant", content: text, tool_calls: toolCalls });

    // 逐个执行工具（串行）
    for (const call of toolCalls) {
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(call.arguments || "{}") as Record<string, unknown>;
      } catch {
        args = {};
      }
      yield { kind: "toolCall", name: call.name, args };
      const tool = byName.get(call.name);
      let result: string;
      if (!tool) {
        result = `Error: 未找到工具 ${call.name}`;
      } else {
        try {
          result = await tool.execute(args);
        } catch (err) {
          result = `Error: ${err instanceof Error ? err.message : String(err)}`;
        }
      }
      // 结果经再加工 hook 回灌
      for (const msg of rework(buildToolResultMessage(call.id, result))) {
        history.push(msg);
      }
    }
  }

  // 达 maxIterations 强制结束
  yield { kind: "done", usage: finalUsage };
}
