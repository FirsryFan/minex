import { createInMemoryStorage, createKernel } from "@minex/kernel";
import { describe, expect, it } from "vitest";
import {
  chatMessagesToSession,
  loadChatHistory,
  newId,
  saveAsSession,
  saveChatHistory,
  sessionToChatMessages,
  type ChatMessageView,
  type SessionLike,
  type SessionNodeLike,
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

function mkSession(nodes: SessionNodeLike[]): SessionLike {
  return {
    meta: { id: "s1", type: "chat", title: "t", tags: [], createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" },
    activeAgents: ["minex.agent"],
    nodes,
    links: [],
  };
}

describe("sessionToChatMessages", () => {
  it("user/assistant/tool 节点 → 对应消息（tool 映射 output/toolName/args）", () => {
    const s = mkSession([
      { id: "n1", kind: "user", content: "你好", ts: "t" },
      { id: "n2", kind: "assistant", content: "你好！", ts: "t" },
      { id: "n3", kind: "tool", toolName: "echo", input: { text: "hi" }, output: "hi", ts: "t" },
    ]);
    expect(sessionToChatMessages(s)).toEqual([
      { role: "user", content: "你好" },
      { role: "assistant", content: "你好！" },
      { role: "tool", content: "hi", toolName: "echo", args: { text: "hi" } },
    ]);
  });

  it("空 session → []", () => {
    expect(sessionToChatMessages(mkSession([]))).toEqual([]);
  });

  it("含 tool 节点（output 缺省）+ 未知节点类型跳过（agent-msg/event 不渲染）", () => {
    const s = mkSession([
      { id: "n1", kind: "tool", toolName: "echo", input: { a: 1 }, ts: "t" },
      { id: "n2", kind: "agent-msg", content: "内部消息", ts: "t" },
      { id: "n3", kind: "event", content: "事件", ts: "t" },
      { id: "n4", kind: "user", content: "x", ts: "t" },
    ]);
    expect(sessionToChatMessages(s)).toEqual([
      { role: "tool", content: "", toolName: "echo", args: { a: 1 } },
      { role: "user", content: "x" },
    ]);
  });

  it("与 chatMessagesToSession 互逆：往返后消息一致", () => {
    const messages: ChatMessageView[] = [
      { role: "user", content: "u" },
      { role: "assistant", content: "a" },
      { role: "tool", content: "o", toolName: "t", args: { k: 1 } },
    ];
    const { nodes, links } = chatMessagesToSession(messages);
    const s = mkSession(nodes as SessionNodeLike[]);
    s.links = links as SessionLike["links"];
    expect(sessionToChatMessages(s)).toEqual(messages);
  });
});

describe("saveAsSession（草稿 → 会话）", () => {
  function kernelWithStore(store: { hasRoot(): boolean; saveSession(s: SessionLike): Promise<void> }) {
    const kernel = testKernel();
    kernel.registry.register("session", "default", store, { driverId: "test" });
    return kernel;
  }

  it("无 session 能力 → 抛错", async () => {
    await expect(saveAsSession(testKernel(), [])).rejects.toThrow(/未找到 session 能力/);
  });

  it("无 filesystem 根目录 → 抛错「请先选择文件夹以启用会话保存」", async () => {
    const kernel = kernelWithStore({ hasRoot: () => false, saveSession: async () => {} });
    await expect(saveAsSession(kernel, [{ role: "user", content: "x" }])).rejects.toThrow(/请先选择文件夹以启用会话保存/);
  });

  it("正常保存：chatMessagesToSession 产物包装成 Session（type chat / activeAgents [minex.agent] / 默认标题）", async () => {
    let saved: SessionLike | undefined;
    const kernel = kernelWithStore({ hasRoot: () => true, saveSession: async (s) => { saved = s; } });
    const messages: ChatMessageView[] = [
      { role: "user", content: "u" },
      { role: "assistant", content: "a" },
    ];
    await saveAsSession(kernel, messages);
    expect(saved).toBeDefined();
    expect(saved!.meta.type).toBe("chat");
    expect(saved!.meta.title).toBe("新会话");
    expect(saved!.activeAgents).toEqual(["minex.agent"]);
    expect(saved!.nodes).toHaveLength(2);
    expect(saved!.nodes[0]).toMatchObject({ kind: "user", content: "u" });
    expect(saved!.links).toEqual([{ from: "msg-1", to: "msg-0", type: "responds" }]);
  });

  it("自定义标题 + newId 唯一性", async () => {
    expect(newId()).not.toBe(newId());
    let saved: SessionLike | undefined;
    const kernel = kernelWithStore({ hasRoot: () => true, saveSession: async (s) => { saved = s; } });
    await saveAsSession(kernel, [{ role: "user", content: "x" }], "我的会话");
    expect(saved!.meta.title).toBe("我的会话");
  });
});
