import { describe, expect, it } from "vitest";
import {
  buildToolResultMessage,
  defaultRework,
  parseAssistantResponse,
  runAgent,
  type AgentDeps,
} from "../src/agent.js";
import type { ChatMessage, LLMChunk } from "minex-llm-driver";

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
