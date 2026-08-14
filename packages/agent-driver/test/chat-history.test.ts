import { createInMemoryStorage, createKernel } from "@minex/kernel";
import { describe, expect, it } from "vitest";
import {
  AUTO_SAVE_THRESHOLD,
  buildChildSystemPrompt,
  chatMessagesToSession,
  loadChatHistory,
  mapContextToMessages,
  newId,
  saveAsSession,
  saveChatHistory,
  sessionToChatMessages,
  shouldAutoSave,
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

describe("buildChildSystemPrompt（2-3 自动继承）", () => {
  const base = "基础 prompt";
  const outlines = [
    { summary: "用户希望用中文交流" },
    { summary: "已讨论文件读取方案" },
  ];

  it("开关关 → 原样返回基础 prompt", () => {
    expect(buildChildSystemPrompt(base, false, outlines)).toBe(base);
  });

  it("开关开但无大纲 → 原样返回基础 prompt", () => {
    expect(buildChildSystemPrompt(base, true, [])).toBe(base);
  });

  it("开关开 + 有大纲 → 基础 prompt + 大纲文本补充（含每条 summary）", () => {
    const out = buildChildSystemPrompt(base, true, outlines);
    expect(out.startsWith(base)).toBe(true);
    expect(out).toContain("大纲记忆");
    expect(out).toContain("- 用户希望用中文交流");
    expect(out).toContain("- 已讨论文件读取方案");
  });
});

describe("shouldAutoSave（P5 自动保存状态机）", () => {
  it("边界：正好达阈值 → true；差一轮 → false；AUTO_SAVE_THRESHOLD = 3", () => {
    expect(AUTO_SAVE_THRESHOLD).toBe(3);
    expect(shouldAutoSave(3, AUTO_SAVE_THRESHOLD)).toBe(true);
    expect(shouldAutoSave(2, AUTO_SAVE_THRESHOLD)).toBe(false);
  });

  it("阈值 0 防御：threshold ≤ 0 → 关闭自动保存（恒 false）", () => {
    expect(shouldAutoSave(10, 0)).toBe(false);
    expect(shouldAutoSave(10, -1)).toBe(false);
  });

  it("负数消息数 → false", () => {
    expect(shouldAutoSave(-1, 3)).toBe(false);
  });
});

describe("mapContextToMessages（3-6 history 角色增强）", () => {
  const session: SessionLike = {
    meta: {
      id: "s1",
      type: "chat",
      title: "t",
      tags: [],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
    activeAgents: [],
    nodes: [
      { id: "u1", kind: "user", content: "问题", ts: "2026-01-01T00:00:00.000Z" },
      { id: "a1", kind: "assistant", content: "回答", ts: "2026-01-01T00:00:00.000Z" },
      { id: "t1", kind: "tool", toolName: "echo", output: "x", ts: "2026-01-01T00:00:00.000Z" },
    ],
    links: [],
  };

  it("user / assistant 节点 → 对应 role；tool 节点跳过", () => {
    const out = mapContextToMessages(
      [
        { ref: "u1", content: "问题" },
        { ref: "a1", content: "回答" },
        { ref: "t1", content: "x" },
      ],
      session,
    );
    expect(out).toEqual([
      { role: "user", content: "问题" },
      { role: "assistant", content: "回答" },
    ]);
  });

  it("ref 非节点 id（parent:tail）/ 节点不存在 → 按 user（兼容旧行为）", () => {
    const out = mapContextToMessages([{ ref: "parent:tail", content: "旧消息" }, { ref: "zzz", content: "y" }], session);
    expect(out).toEqual([
      { role: "user", content: "旧消息" },
      { role: "user", content: "y" },
    ]);
  });

  it("空 contextItems → 空数组", () => {
    expect(mapContextToMessages([], session)).toEqual([]);
  });
});
