import { useCallback, useEffect, useRef, useState } from "react";
import type { MinexKernel } from "@minex/kernel";
import {
  loadChatHistory,
  newId,
  saveAsSession,
  saveChatHistory,
  sessionToChatMessages,
  type ChatMessageView,
  type SessionLike,
  type SessionLinkLike,
  type SessionNodeLike,
} from "./chat-history.js";
import { takePendingOpenSessionId } from "./session-open.js";

const SYSTEM_PROMPT = "你是一个乐于助人的 AI 助手，用中文回答。";

/** agent 能力子集（宿主视图取能力值要 .value） */
interface AgentCap {
  run(systemPrompt: string, history: unknown[], maxIterations?: number): AsyncIterable<AgentEvent>;
}

interface AgentEvent {
  kind: "text" | "toolCall" | "done" | "error";
  delta?: string;
  name?: string;
  args?: unknown;
  message?: string;
}

interface MarkdownCap {
  render(src: string): string;
}

/** session 能力子集（跨包零源码 import，结构类型） */
interface SessionStoreCap {
  hasRoot(): boolean;
  loadSession(id: string): Promise<SessionLike | undefined>;
  saveSession(s: SessionLike): Promise<void>;
}

/** session.tree 能力子集（2-1 会话树纯函数，经能力桥接；形状与 session-tree.ts 导出一致） */
interface SessionTreeCap {
  buildContext(
    session: SessionLike,
    branchId: string,
    opts?: { selectedNodeIds?: string[]; tailCount?: number },
  ): Array<{ ref: string; content: string }>;
  deriveBranches(session: SessionLike): Array<{ id: string; entryNodeId: string; nodeIds: string[]; headNodeId: string }>;
  addNode(s: SessionLike, node: SessionNodeLike): SessionLike;
  addLink(s: SessionLike, link: SessionLinkLike): SessionLike;
}

/**
 * Agent 聊天工作区（task 1-3 + 2-2 双模式）：
 * - 草稿模式（无 session）：localStorage chatHistory = 未保存草稿；顶部「保存为会话」（saveAsSession → 清空草稿）；
 * - 会话模式（有 session）：session = 唯一真相源——挂载渲染全部历史（sessionToChatMessages），
 *   发消息 = user 节点 append + saveSession → agent.run history = buildContext(session, currentBranchId)
 *   （tail 默认 10：父链更早消息不进 LLM history，UI 仍显示全部）→ 回复 done 后 assistant/tool 节点 append + saveSession。
 * 打开会话入口：minex:openSession 事件（挂载时读暂存 id + 已挂载时订阅切换）。
 */
export default function ChatView({
  kernel,
  instanceId,
  session: sessionProp,
}: {
  kernel: MinexKernel;
  instanceId?: number;
  session?: SessionLike;
}) {
  // .value 纪律：registry.get 返回 Contribution，能力值在 .value
  const agent = kernel.registry.get<AgentCap>("agent", "default")?.value;
  const md = kernel.registry.get<MarkdownCap>("markdown", "render")?.value;
  const store = kernel.registry.get<SessionStoreCap>("session", "default")?.value;
  const tree = kernel.registry.get<SessionTreeCap>("session.tree", "default")?.value;

  const [session, setSession] = useState<SessionLike | null>(sessionProp ?? null);
  // 会话模式：历史来自 session；草稿模式：历史来自 localStorage（刷新不丢）
  const [messages, setMessages] = useState<ChatMessageView[]>(() =>
    sessionProp ? sessionToChatMessages(sessionProp) : loadChatHistory(kernel, instanceId),
  );
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const cancelledRef = useRef(false);

  const isSessionMode = session !== null;

  // 卸载时中断进行中的 for await（loop 内检查 cancelledRef）
  useEffect(() => {
    return () => {
      cancelledRef.current = true;
    };
  }, []);

  const openSession = useCallback(
    async (id: string): Promise<void> => {
      if (!store) return;
      const s = await store.loadSession(id);
      if (!s) return;
      setSession(s);
      setMessages(sessionToChatMessages(s));
    },
    [store],
  );

  // 打开会话入口：挂载时读暂存 id（App 切驱动竞态桥接）+ 订阅事件（已挂载时切换会话）
  useEffect(() => {
    const pending = takePendingOpenSessionId();
    if (pending) void openSession(pending);
    return kernel.events.on("minex:openSession", (payload) => {
      takePendingOpenSessionId(); // 已挂载则直接处理，丢弃暂存防重复打开
      const id = (payload as { id?: string } | undefined)?.id;
      if (id) void openSession(id);
    });
  }, [kernel, openSession]);

  // 草稿模式：messages 变化 → 落盘（会话模式 session 为真相源，不写草稿）
  useEffect(() => {
    if (isSessionMode) return;
    saveChatHistory(kernel, instanceId, messages);
  }, [kernel, instanceId, messages, isSessionMode]);

  /** 追加流式 delta 到视图尾部 assistant 消息（尾部非 assistant 则新建）。 */
  function appendAssistantDelta(prev: ChatMessageView[], delta: string): ChatMessageView[] {
    const last = prev[prev.length - 1];
    if (last && last.role === "assistant" && !last.error) {
      const next = [...prev];
      next[next.length - 1] = { ...last, content: last.content + delta };
      return next;
    }
    return [...prev, { role: "assistant", content: delta }];
  }

  async function sendDraft(text: string): Promise<void> {
    if (!agent) return;
    const userMsg: ChatMessageView = { role: "user", content: text };
    setMessages((prev) => [...prev, userMsg]);
    // history = user/assistant 的 {role, content} 映射（含本轮新消息；error/tool 不进历史）
    const history = [...messages, userMsg]
      .filter((m) => (m.role === "user" || m.role === "assistant") && !m.error)
      .map((m) => ({ role: m.role, content: m.content }));
    try {
      for await (const ev of agent.run(SYSTEM_PROMPT, history)) {
        if (cancelledRef.current) break;
        if (ev.kind === "text") {
          setMessages((prev) => appendAssistantDelta(prev, ev.delta ?? ""));
        } else if (ev.kind === "toolCall") {
          setMessages((prev) => [...prev, { role: "tool", content: "", toolName: ev.name, args: ev.args }]);
        } else if (ev.kind === "error") {
          setMessages((prev) => [...prev, { role: "assistant", content: ev.message ?? "发生错误", error: true }]);
        } else if (ev.kind === "done") {
          break;
        }
      }
    } finally {
      setStreaming(false);
    }
  }

  async function sendSessionMode(text: string): Promise<void> {
    if (!agent || !store || !tree || !session) return;
    const branchId = session.meta.currentBranchId ?? "main";
    const headNodeId = tree.deriveBranches(session).find((b) => b.id === branchId)?.headNodeId;

    // 1) user 节点 append（responds 到当前分支头）→ saveSession
    const userNode: SessionNodeLike = { id: newId(), kind: "user", content: text, ts: new Date().toISOString() };
    let s2 = tree.addNode(session, userNode);
    if (headNodeId) s2 = tree.addLink(s2, { from: userNode.id, to: headNodeId, type: "responds" });
    setSession(s2);
    setMessages(sessionToChatMessages(s2));
    await store.saveSession(s2);

    // 2) agent.run history = buildContext（当前分支上下文，tail 默认 10——父链更早消息不进 history，UI 仍显示全部）
    const history = tree.buildContext(s2, branchId).map((c) => ({ role: "user" as const, content: c.content }));

    const deltas: string[] = [];
    const toolCalls: Array<{ name: string; args: unknown }> = [];
    let errorMsg: string | undefined;
    try {
      for await (const ev of agent.run(SYSTEM_PROMPT, history)) {
        if (cancelledRef.current) break;
        if (ev.kind === "text") {
          deltas.push(ev.delta ?? "");
          setMessages((prev) => appendAssistantDelta(prev, ev.delta ?? ""));
        } else if (ev.kind === "toolCall") {
          toolCalls.push({ name: ev.name ?? "", args: ev.args });
          setMessages((prev) => [...prev, { role: "tool", content: "", toolName: ev.name, args: ev.args }]);
        } else if (ev.kind === "error") {
          const msg = ev.message ?? "发生错误";
          errorMsg = msg;
          setMessages((prev) => [...prev, { role: "assistant", content: msg, error: true }]);
        } else if (ev.kind === "done") {
          break;
        }
      }
    } finally {
      setStreaming(false);
    }

    // 3) done 后 assistant/tool 节点 append + saveSession（节点序：user → tool… → assistant）
    let s3 = s2;
    let prevId = userNode.id;
    const now = new Date().toISOString();
    const appendNode = (node: SessionNodeLike): void => {
      s3 = tree.addNode(s3, node);
      s3 = tree.addLink(s3, { from: node.id, to: prevId, type: "responds" });
      prevId = node.id;
    };
    for (const tc of toolCalls) {
      appendNode({ id: newId(), kind: "tool", toolName: tc.name, input: tc.args, output: "", ts: now });
    }
    const finalText = errorMsg ?? deltas.join("");
    if (finalText) appendNode({ id: newId(), kind: "assistant", content: finalText, ts: now });
    setSession(s3);
    setMessages(sessionToChatMessages(s3));
    await store.saveSession(s3);
  }

  async function send(): Promise<void> {
    const text = input.trim();
    if (!text || streaming || !agent) return;
    setInput("");
    setStreaming(true);
    cancelledRef.current = false;
    if (isSessionMode) await sendSessionMode(text);
    else await sendDraft(text);
  }

  async function saveDraft(): Promise<void> {
    setSaveError(null);
    try {
      await saveAsSession(kernel, messages);
      setMessages([]);
      saveChatHistory(kernel, instanceId, []); // 草稿清空（迁移完成）
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className="chat-view">
      <div className="chat-head">
        {isSessionMode ? (
          <span className="muted">会话：{session.meta.title}</span>
        ) : (
          messages.length > 0 && (
            <button className="btn-ghost" onClick={() => void saveDraft()}>
              保存为会话
            </button>
          )
        )}
        {saveError && <span className="chat-save-error">{saveError}</span>}
      </div>
      <div className="chat-messages">
        {messages.map((m, i) => {
          if (m.role === "tool") {
            return (
              <div key={i} className="chat-msg tool">
                <div className="chat-tool-name">调用工具 {m.toolName ?? "?"}</div>
                {m.args !== undefined && <pre className="chat-tool-args">{JSON.stringify(m.args, null, 2)}</pre>}
              </div>
            );
          }
          // assistant 内容用 markdown 渲染（dangerouslySetInnerHTML，参考 markdown workspace preview）
          const html = m.role === "assistant" && md && m.content ? md.render(m.content) : null;
          return (
            <div key={i} className={`chat-msg ${m.role}${m.error ? " error" : ""}`}>
              {html ? (
                <div className="markdown-body" dangerouslySetInnerHTML={{ __html: html }} />
              ) : (
                <div>{m.content}</div>
              )}
            </div>
          );
        })}
      </div>
      <div className="chat-input-row">
        <input
          value={input}
          placeholder="输入消息…"
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void send();
          }}
          disabled={streaming}
        />
        <button className="btn" onClick={() => void send()} disabled={streaming || input.trim() === ""}>
          发送
        </button>
      </div>
    </div>
  );
}
