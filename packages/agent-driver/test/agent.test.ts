import { describe, expect, it } from "vitest";
import {
  buildToolResultMessage,
  defaultRework,
  parseAssistantResponse,
  runAgent,
  type AgentDeps,
  type AgentEvent,
} from "../src/agent.js";
import type { ChatMessage, LLMChunk, LLMMetricsEntry } from "minex-llm-driver";

function makeDeps(
  stream: AgentDeps["stream"],
  tools = [{ name: "echo", description: "d", parameters: {}, execute: async () => "ok" }],
): AgentDeps {
  return {
    stream,
    tools,
    model: "deepseek-chat",
    recordMetrics: () => {},
    prices: { inputHit: 0.07, inputMiss: 0.27, output: 1.1 },
  };
}

async function collect(events: AsyncIterable<{ kind: string }>): Promise<string[]> {
  const kinds: string[] = [];
  for await (const e of events) kinds.push(e.kind);
  return kinds;
}

describe("parseAssistantResponse", () => {
  it("纯文本：无 tool_calls", () => {
    const r = parseAssistantResponse({ content: "你好", toolCallDeltas: [] });
    expect(r).toEqual({ text: "你好", toolCalls: [] });
  });
  it("单 tool_call（多分片重组）", () => {
    const r = parseAssistantResponse({
      content: "",
      toolCallDeltas: [
        { index: 0, id: "call_1", name: "echo", arguments: '{"text"' },
        { index: 0, arguments: ':"hello"}' },
      ],
    });
    expect(r.toolCalls).toEqual([{ id: "call_1", name: "echo", arguments: '{"text":"hello"}' }]);
  });
  it("多 tool_call 按 index 排序", () => {
    const r = parseAssistantResponse({
      content: "",
      toolCallDeltas: [
        { index: 1, id: "c2", name: "b" },
        { index: 0, id: "c1", name: "a" },
      ],
    });
    expect(r.toolCalls.map((c) => c.name)).toEqual(["a", "b"]);
  });
  it("空：无内容无分片", () => {
    expect(parseAssistantResponse({ content: "", toolCallDeltas: [] })).toEqual({ text: "", toolCalls: [] });
  });
});

describe("buildToolResultMessage", () => {
  it("构造 role=tool + tool_call_id + content", () => {
    expect(buildToolResultMessage("call_1", "结果")).toEqual({ role: "tool", content: "结果", tool_call_id: "call_1" });
  });
});

describe("defaultRework", () => {
  it("透传", () => {
    const m: ChatMessage = { role: "tool", content: "x", tool_call_id: "id" };
    expect(defaultRework(m)).toEqual([m]);
  });
});

describe("runAgent loop 停止条件", () => {
  it("无 tool_call：一轮后 done", async () => {
    async function* stream(): AsyncIterable<LLMChunk> {
      yield { delta: "你好", done: false };
      yield { delta: "", done: true, usage: { promptTokens: 10, completionTokens: 2, cachedTokens: 0 } };
    }
    const events = runAgent(makeDeps(stream), { systemPrompt: "s", history: [] });
    const kinds = await collect(events);
    expect(kinds).toEqual(["text", "done"]);
  });

  it("maxIterations 强制结束", async () => {
    // 每次 stream 都返回 tool_call（永不结束），靠 maxIterations=2 停
    async function* stream(): AsyncIterable<LLMChunk> {
      yield { delta: "", done: false, toolCallDelta: { index: 0, id: "c", name: "echo", arguments: "{}" } };
      yield { delta: "", done: true, usage: { promptTokens: 10, completionTokens: 0, cachedTokens: 0 } };
    }
    const events = runAgent(makeDeps(stream), { systemPrompt: "s", history: [], maxIterations: 2 });
    const kinds = await collect(events);
    // 每轮：toolCall + （无 text）; 最终 done
    expect(kinds).toEqual(["toolCall", "toolCall", "done"]);
  });

  it("工具执行后继续循环直到无 tool_call", async () => {
    let calls = 0;
    async function* stream(): AsyncIterable<LLMChunk> {
      calls++;
      if (calls === 1) {
        // 第一轮：调 echo 工具
        yield { delta: "", done: false, toolCallDelta: { index: 0, id: "c1", name: "echo", arguments: '{"text":"hi"}' } };
      } else {
        // 第二轮：产出最终答案（无 tool_call）
        yield { delta: "答案", done: false };
      }
      yield { delta: "", done: true, usage: { promptTokens: 10, completionTokens: 2, cachedTokens: 0 } };
    }
    const events = runAgent(makeDeps(stream), { systemPrompt: "s", history: [] });
    const kinds = await collect(events);
    expect(kinds).toEqual(["toolCall", "text", "done"]);
    expect(calls).toBe(2);
  });
});

describe("runAgent onContext 加工 hook（2-4）", () => {
  it("loop 内 buildMessages 前调用，传当前轮 history 尾部（含用户消息）", async () => {
    const calls: Array<Array<{ ref: string; content: string }>> = [];
    async function* stream(): AsyncIterable<LLMChunk> {
      // 每轮都返回 tool_call（两轮），验证每轮 onContext 都被调
      yield { delta: "", done: false, toolCallDelta: { index: 0, id: "c", name: "echo", arguments: "{}" } };
      yield { delta: "", done: true, usage: { promptTokens: 10, completionTokens: 0, cachedTokens: 0 } };
    }
    const events = runAgent(makeDeps(stream), {
      systemPrompt: "s",
      history: [{ role: "user", content: "你好" }],
      maxIterations: 2,
      onContext: (items) => calls.push(items),
    });
    await collect(events);
    expect(calls.length).toBeGreaterThanOrEqual(1);
    expect(calls[0]).toEqual([{ ref: "h0", content: "你好" }]); // 首轮 = history 尾部（用户消息）
  });

  it("默认不调用：无 onContext 时正常执行（向后兼容）", async () => {
    async function* stream(): AsyncIterable<LLMChunk> {
      yield { delta: "答", done: false };
      yield { delta: "", done: true, usage: { promptTokens: 5, completionTokens: 1, cachedTokens: 0 } };
    }
    const events = runAgent(makeDeps(stream), { systemPrompt: "s", history: [] });
    expect(await collect(events)).toEqual(["text", "done"]);
  });
});

describe("runAgent 工具并行执行", () => {
  it("多个无依赖 tool_calls 并行（并发计数）+ 结果按声明顺序回灌", async () => {
    let active = 0;
    let maxActive = 0;
    let calls = 0;
    let secondRoundMessages: ChatMessage[] = [];
    async function* stream(req: { messages: ChatMessage[] }): AsyncIterable<LLMChunk> {
      calls++;
      if (calls === 1) {
        // 一轮产出 2 个无依赖 tool_calls（c1 声明在前、c2 在后）
        yield { delta: "", done: false, toolCallDelta: { index: 0, id: "c1", name: "slow-1", arguments: "{}" } };
        yield { delta: "", done: false, toolCallDelta: { index: 1, id: "c2", name: "slow-2", arguments: "{}" } };
      } else {
        // 第二轮：捕获回灌后的 messages，产出最终答案（无 tool_call）
        secondRoundMessages = req.messages;
        yield { delta: "结束", done: false };
      }
      yield { delta: "", done: true, usage: { promptTokens: 10, completionTokens: 2, cachedTokens: 0 } };
    }
    // 两个可区分工具：slow-1 返回 "r1"、slow-2 返回 "r2"（同耗时制造并行窗口）
    const mkSlow = (name: string, result: string) => ({
      name,
      description: "d",
      parameters: {},
      execute: async () => {
        active++;
        maxActive = Math.max(maxActive, active);
        await new Promise((r) => setTimeout(r, 20));
        active--;
        return result;
      },
    });
    const events = runAgent(makeDeps(stream, [mkSlow("slow-1", "r1"), mkSlow("slow-2", "r2")]), {
      systemPrompt: "s",
      history: [],
      maxIterations: 2,
    });
    await collect(events);
    expect(maxActive).toBeGreaterThanOrEqual(2); // 并行执行（非串行）
    // 结果按 toolCalls 声明序回灌：c1 的 r1 在前、c2 的 r2 在后（若被改成按完成序回灌，此断言必红）
    const toolMsgs = secondRoundMessages.filter((m) => m.role === "tool");
    expect(toolMsgs.map((m) => m.content)).toEqual(["r1", "r2"]);
    expect(toolMsgs.map((m) => m.tool_call_id)).toEqual(["c1", "c2"]);
  });
});

describe("runAgent 计量集成", () => {
  it("stream 结束后 recordMetrics 被调用且 cost/hitRate 正确（审查 INFO-5）", async () => {
    const recorded: LLMMetricsEntry[] = [];
    async function* stream(): AsyncIterable<LLMChunk> {
      yield { delta: "答", done: false };
      yield { delta: "", done: true, usage: { promptTokens: 1_000_000, completionTokens: 1_000_000, cachedTokens: 400_000 } };
    }
    const deps = makeDeps(stream);
    deps.recordMetrics = (e) => recorded.push(e);
    await collect(runAgent(deps, { systemPrompt: "s", history: [] }));
    expect(recorded).toHaveLength(1);
    const entry = recorded[0];
    expect(entry.promptTokens).toBe(1_000_000);
    expect(entry.completionTokens).toBe(1_000_000);
    expect(entry.cachedTokens).toBe(400_000);
    // hit 0.4M×0.07 + miss 0.6M×0.27 + output 1M×1.1 = 0.028 + 0.162 + 1.1 = 1.29
    expect(entry.cost).toBeCloseTo(1.29, 10);
    expect(entry.hitRate).toBeCloseTo(0.4, 10);
  });
});

describe("runAgent 权限裁决（3-2 canRun）", () => {
  it("canRun 传 {name, risk}；false → 结果 = 用户拒绝执行 <name>（不抛错、正常回灌）", async () => {
    let secondRoundMessages: ChatMessage[] = [];
    let calls = 0;
    async function* stream(req: { messages: ChatMessage[] }): AsyncIterable<LLMChunk> {
      calls++;
      if (calls === 1) {
        yield { delta: "", done: false, toolCallDelta: { index: 0, id: "c1", name: "write_file", arguments: "{}" } };
      } else {
        secondRoundMessages = req.messages;
        yield { delta: "结束", done: false };
      }
      yield { delta: "", done: true, usage: { promptTokens: 10, completionTokens: 1, cachedTokens: 0 } };
    }
    const writeTool = {
      name: "write_file",
      description: "d",
      parameters: {},
      risk: "write" as const,
      execute: async () => "wrote",
    };
    const seen: Array<{ name: string; risk: string }> = [];
    const canRun = async (call: { name: string; risk: string }): Promise<boolean> => {
      seen.push(call);
      return false;
    };
    const events = runAgent(makeDeps(stream, [writeTool]), { systemPrompt: "s", history: [], canRun });
    await collect(events);
    expect(seen).toEqual([{ name: "write_file", risk: "write" }]); // risk 表正确传递
    const toolMsg = secondRoundMessages.find((m) => m.role === "tool");
    expect(toolMsg?.content).toBe("用户拒绝执行 write_file");
  });

  it("canRun 返回 true → 工具正常执行；旧工具无 risk 字段 → 按 read 传", async () => {
    let secondRoundMessages: ChatMessage[] = [];
    let calls = 0;
    async function* stream(req: { messages: ChatMessage[] }): AsyncIterable<LLMChunk> {
      calls++;
      if (calls === 1) {
        yield { delta: "", done: false, toolCallDelta: { index: 0, id: "c1", name: "echo", arguments: "{}" } };
      } else {
        secondRoundMessages = req.messages;
        yield { delta: "结束", done: false };
      }
      yield { delta: "", done: true, usage: { promptTokens: 10, completionTokens: 1, cachedTokens: 0 } };
    }
    const seen: Array<{ name: string; risk: string }> = [];
    const events = runAgent(makeDeps(stream), {
      systemPrompt: "s",
      history: [],
      canRun: async (call) => {
        seen.push(call);
        return true;
      },
    });
    await collect(events);
    expect(seen).toEqual([{ name: "echo", risk: "read" }]); // 缺省 risk = read
    expect(secondRoundMessages.find((m) => m.role === "tool")?.content).toBe("ok");
  });
});

describe("runAgent 模型参数透传 + done 带 cost（3-3）", () => {
  it("params 透传到 stream req；done 事件带 cost（finalUsage × prices）", async () => {
    const seenReqs: Array<{ params?: Record<string, unknown> }> = [];
    async function* stream(req: { params?: Record<string, unknown> }): AsyncIterable<LLMChunk> {
      seenReqs.push(req);
      yield { delta: "答", done: false };
      yield { delta: "", done: true, usage: { promptTokens: 1_000_000, completionTokens: 1_000_000, cachedTokens: 400_000 } };
    }
    const events: AgentEvent[] = [];
    for await (const e of runAgent(makeDeps(stream), { systemPrompt: "s", history: [], params: { temperature: 0.7 } })) {
      events.push(e);
    }
    expect(seenReqs[0].params).toEqual({ temperature: 0.7 });
    const done = events.find((e) => e.kind === "done");
    expect(done).toMatchObject({ usage: { promptTokens: 1_000_000, completionTokens: 1_000_000 } });
    expect((done as { cost?: number }).cost).toBeCloseTo(1.29, 10); // 与计量用例同价表
  });

  it("无 params → stream req 不带 params 字段", async () => {
    const seenReqs: Array<Record<string, unknown>> = [];
    async function* stream(req: Record<string, unknown>): AsyncIterable<LLMChunk> {
      seenReqs.push(req);
      yield { delta: "答", done: false };
      yield { delta: "", done: true, usage: { promptTokens: 1, completionTokens: 0, cachedTokens: 0 } };
    }
    await collect(runAgent(makeDeps(stream), { systemPrompt: "s", history: [] }));
    expect(seenReqs[0].params).toBeUndefined();
  });
});

describe("runAgent 再加工 hook", () => {
  it("注入自定义 rework：工具结果按 hook 加工后回灌", async () => {
    let secondRoundMessages: ChatMessage[] = [];
    let calls = 0;
    async function* stream(req: { messages: ChatMessage[] }): AsyncIterable<LLMChunk> {
      calls++;
      if (calls === 1) {
        yield { delta: "", done: false, toolCallDelta: { index: 0, id: "c1", name: "echo", arguments: '{"text":"hi"}' } };
      } else {
        secondRoundMessages = req.messages;
        yield { delta: "结束", done: false };
      }
      yield { delta: "", done: true, usage: { promptTokens: 10, completionTokens: 1, cachedTokens: 0 } };
    }
    const rework = (m: ChatMessage): ChatMessage[] => [{ ...m, content: `加工:${m.content}` }];
    const echoLike = { name: "echo", description: "d", parameters: {}, execute: async (a: Record<string, unknown>) => String(a.text ?? "") };
    const events = runAgent(makeDeps(stream, [echoLike]), { systemPrompt: "s", history: [], rework });
    await collect(events);
    const toolMsg = secondRoundMessages.find((m) => m.role === "tool");
    expect(toolMsg?.content).toBe("加工:hi"); // echo 返回 "hi"，经 rework 加工后回灌
    expect(toolMsg?.tool_call_id).toBe("c1");
  });
});
