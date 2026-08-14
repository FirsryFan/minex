import { createInMemoryStorage, createKernel } from "@minex/kernel";
import { describe, expect, it } from "vitest";
import {
  chatMessagesToSession,
  loadChatHistory,
  saveChatHistory,
  type ChatMessageView,
} from "../src/chat-history.js";

function testKernel() {
  return createKernel({ storage: createInMemoryStorage() });
}

describe("chatMessagesToSession", () => {
  it("正常映射：user/assistant/tool 三种节点 + 线性 responds 链接", () => {
    const messages: ChatMessageView[] = [
      { role: "user", content: "你好" },
      { role: "assistant", content: "你好！" },
      { role: "tool", content: "hi", toolName: "echo", args: { text: "hi" } },
    ];
    const { nodes, links } = chatMessagesToSession(messages);
    expect(nodes).toHaveLength(3);
    expect(nodes[0]).toMatchObject({ id: "msg-0", kind: "user", content: "你好" });
    expect(nodes[1]).toMatchObject({ id: "msg-1", kind: "assistant", content: "你好！" });
    expect(nodes[2]).toMatchObject({
      id: "msg-2",
      kind: "tool",
      toolName: "echo",
      input: { text: "hi" },
      output: "hi",
    });
    for (const n of nodes as Array<Record<string, unknown>>) {
      expect(typeof n.ts).toBe("string");
      expect(String(n.ts).length).toBeGreaterThan(0); // ts 用当前时间
    }
    expect(links).toEqual([
      { from: "msg-1", to: "msg-0", type: "responds" },
      { from: "msg-2", to: "msg-1", type: "responds" },
    ]);
  });

  it("空数组 → 空节点空链接", () => {
    expect(chatMessagesToSession([])).toEqual({ nodes: [], links: [] });
  });

  it("单条消息 → 无链接", () => {
    const { nodes, links } = chatMessagesToSession([{ role: "user", content: "x" }]);
    expect(nodes).toHaveLength(1);
    expect(links).toEqual([]);
  });
});

describe("loadChatHistory / saveChatHistory", () => {
  it("缺失 key → []", () => {
    const kernel = testKernel();
    expect(loadChatHistory(kernel, 0)).toEqual([]);
  });

  it("损坏 JSON → []（try/catch 不抛错）", () => {
    const kernel = testKernel();
    kernel.storage.namespace("minex.agent").set("chatHistory@0", "{not json");
    expect(loadChatHistory(kernel, 0)).toEqual([]);
  });

  it("非数组 JSON → []", () => {
    const kernel = testKernel();
    kernel.storage.namespace("minex.agent").set("chatHistory@0", '{"a":1}');
    expect(loadChatHistory(kernel, 0)).toEqual([]);
  });

  it("save → load 往返一致；instanceId 隔离", () => {
    const kernel = testKernel();
    const msgs: ChatMessageView[] = [
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello" },
    ];
    saveChatHistory(kernel, 0, msgs);
    expect(loadChatHistory(kernel, 0)).toEqual(msgs);
    expect(loadChatHistory(kernel, 1)).toEqual([]); // 其他实例互不干扰
  });

  it("instanceId 缺省 → key 用 0（同一会话）", () => {
    const kernel = testKernel();
    saveChatHistory(kernel, undefined, [{ role: "user", content: "a" }]);
    expect(loadChatHistory(kernel, 0)).toEqual([{ role: "user", content: "a" }]);
  });
});
