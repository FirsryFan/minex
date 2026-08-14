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
import { execute, type Task } from "./scheduler.js";
import type { AgentTool } from "./tool.js";

/** agent loop 事件（流式） */
export type AgentEvent =
  | { kind: "text"; delta: string }
  | { kind: "toolCall"; name: string; args: unknown }
  | { kind: "done"; usage?: LLMUsage; cost?: number } // 3-3：done 带 cost（用量 × 价格表）
  | { kind: "error"; message: string };

export interface RunAgentOptions {
  systemPrompt: string;
  history: ChatMessage[];
  maxIterations?: number;
  /** 一轮内多个无依赖工具调用的最大并行数（默认 4） */
  maxConcurrent?: number;
  /** 再加工 hook（W 层）：工具结果回灌前加工，默认透传 */
  rework?: (result: ChatMessage) => ChatMessage[];
  /**
   * 上下文加工 hook（2-4 大纲记忆）：loop 内 buildMessages 之前调用，
   * 把当前轮 history 尾部 context 传给它（供消费方提炼大纲记忆等）；默认不调用任何逻辑，向后兼容。
   */
  onContext?: (contextItems: Array<{ ref: string; content: string }>) => void;
  /**
   * 权限裁决 hook（3-2）：每个工具调用执行前调用；false → 结果文本「用户拒绝执行 <name>」（不抛错）。
   * 缺省不调用（全部放行，向后兼容）。
   */
  canRun?: (call: { name: string; risk: string }) => Promise<boolean>;
  /** 3-3 模型参数（temperature 等）透传给 stream req；缺省不传（用 llm 驱动默认参数） */
  params?: Record<string, unknown>;
  /** 3-4 真停止：AbortController 全链——abort → stream 抛 AbortError → 产 done（不产 error 不记 metrics） */
  signal?: AbortSignal;
  /** 3-4 插入指令：每轮 buildMessages 前调用，返回用户插入的消息（读后由消费方清空） */
  pendingMessages?: () => ChatMessage[];
}

/** onContext 传入的 history 尾部条数（与 buildContext tailCount 默认一致） */
const CONTEXT_TAIL = 10;

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
    // 2-4 加工 hook：buildMessages 之前把当前轮 history 尾部 context 传出（默认不调用）
    if (opts.onContext) {
      opts.onContext(
        history.slice(-CONTEXT_TAIL).map((m, idx) => ({ ref: `h${idx}`, content: m.content ?? "" })),
      );
    }
    // 3-4 插入指令：buildMessages 前注入（tool_call 结果回灌后，下一轮 LLM 优先处理用户插入）
    if (opts.pendingMessages) {
      history.push(...(opts.pendingMessages() ?? []));
    }
    const messages = buildMessages({ systemPrompt: opts.systemPrompt, history, workMemory: [] });
    const acc: AccumulatedResponse = { content: "", toolCallDeltas: [] };
    let ttftMs = 0;
    let first = true;

    try {
      for await (const chunk of deps.stream({
        model: deps.model,
        messages,
        tools,
        stream: true,
        ...(opts.params ? { params: opts.params } : {}), // 3-3：会话级参数透传
        ...(opts.signal ? { signal: opts.signal } : {}), // 3-4：真停止
      })) {
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
      // 3-4 真停止：abort 非失败——产 done（带已有 usage/cost），不产 error、不记 metrics
      if (err instanceof DOMException && err.name === "AbortError") {
        yield {
          kind: "done",
          usage: finalUsage,
          cost: finalUsage ? computeCost(finalUsage, deps.prices) : undefined,
        };
        return;
      }
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

    // 无工具调用 → 结束（产出 done + usage + cost）
    if (toolCalls.length === 0) {
      // 回灌 assistant 文本
      history.push({ role: "assistant", content: text });
      yield { kind: "done", usage: finalUsage, cost: finalUsage ? computeCost(finalUsage, deps.prices) : undefined };
      return;
    }

    // 回灌 assistant（带 tool_calls）
    history.push({ role: "assistant", content: text, tool_calls: toolCalls });

    // 工具执行：先按声明顺序 yield toolCall 事件（UI 顺序稳定），再经 scheduler.execute 并行执行
    for (const call of toolCalls) {
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(call.arguments || "{}") as Record<string, unknown>;
      } catch {
        args = {};
      }
      yield { kind: "toolCall", name: call.name, args };
    }

    const toolTasks: Task<ToolCall>[] = toolCalls.map((call, index) => ({
      id: String(index),
      deps: [],
      payload: call,
    }));
    const maxConcurrent = opts.maxConcurrent ?? 4;
    // 3-2：工具 risk 表（缺省 read，兼容旧工具无 risk 字段）
    const riskOf = new Map(deps.tools.map((t) => [t.name, t.risk ?? "read"]));
    const toolResults = await execute(toolTasks, async (task) => {
      const call = task.payload;
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(call.arguments || "{}") as Record<string, unknown>;
      } catch {
        args = {};
      }
      const tool = byName.get(call.name);
      if (!tool) return `Error: 未找到工具 ${call.name}`;
      // 3-2 权限裁决：false → 拒绝文本（不抛错，结果照常回灌）
      if (opts.canRun) {
        const ok = await opts.canRun({ name: call.name, risk: riskOf.get(call.name) ?? "read" });
        if (!ok) return `用户拒绝执行 ${call.name}`;
      }
      try {
        return await tool.execute(args);
      } catch (err) {
        return `Error: ${err instanceof Error ? err.message : String(err)}`;
      }
    }, { maxConcurrent });

    // 结果按原 toolCalls 声明顺序回灌（缓存友好）；run 回调已把错误转字符串，result 为 string
    for (let i = 0; i < toolCalls.length; i++) {
      const call = toolCalls[i];
      const text = String(toolResults.get(String(i)) ?? "");
      for (const msg of rework(buildToolResultMessage(call.id, text))) {
        history.push(msg);
      }
    }
  }

  // 达 maxIterations 强制结束
  yield { kind: "done", usage: finalUsage, cost: finalUsage ? computeCost(finalUsage, deps.prices) : undefined };
}
