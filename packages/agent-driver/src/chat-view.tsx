import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MinexKernel } from "@minex/kernel";
import {
  buildChildSystemPrompt,
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
import { buildOutlineEntry, shouldOutline, type OutlineEntryLike } from "./outline.js";
import { takePendingOpenSessionId } from "./session-open.js";

const SYSTEM_PROMPT = "你是一个乐于助人的 AI 助手，用中文回答。";

/** agent 能力子集（宿主视图取能力值要 .value） */
interface AgentCap {
  run(
    systemPrompt: string,
    history: unknown[],
    maxIterations?: number,
    opts?: { onContext?: (contextItems: Array<{ ref: string; content: string }>) => void },
  ): AsyncIterable<AgentEvent>;
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
  createSession(input: { title?: string; activeAgents?: string[] }): SessionLike;
  addOutlineEntry(s: SessionLike, entry: OutlineEntryLike): SessionLike;
}

/** 上下文条目（2-3：子对话初始 context / 手动追加） */
interface ContextItemLike {
  ref: string;
  content: string;
}

/** 大纲条目形状（session.meta.outlines 结构子集） */
interface OutlineLike {
  id: string;
  summary: string;
}

/** 框选状态（2-3 消息级框选） */
interface SelectionState {
  text: string;
  nodeId: string | null;
  x: number;
  y: number;
}

/**
 * Agent 聊天工作区（task 1-3 + 2-2 双模式 + 2-3 非线性）：
 * - 草稿模式（无 session）：localStorage chatHistory = 未保存草稿；顶部「保存为会话」（saveAsSession → 清空草稿）；
 * - 会话模式（有 session）：session = 唯一真相源——挂载渲染全部历史（sessionToChatMessages），
 *   发消息 = user 节点 append + saveSession → agent.run history = buildContext(session, currentBranchId)
 *   （tail 默认 10：父链更早消息不进 LLM history，UI 仍显示全部）→ 回复 done 后 assistant/tool 节点 append + saveSession。
 * - 2-3：消息级框选 → 「与 AI 讨论这段」→ 浮窗子对话（创建子会话 + 父会话挂 branch 链接 + contextItems 注入）；
 *   子对话内「添加上上下文」面板（父大纲勾选应用 / 自动继承 systemPrompt 补充）+ agent 下拉（改子会话 activeAgents）。
 * 打开会话入口：minex:openSession 事件（挂载时读暂存 id + 已挂载时订阅切换；sessionProp 直传时不响应——浮窗子对话）。
 */
export default function ChatView({
  kernel,
  instanceId,
  session: sessionProp,
  contextItems,
  parentSession,
}: {
  kernel: MinexKernel;
  instanceId?: number;
  session?: SessionLike;
  contextItems?: ContextItemLike[];
  parentSession?: SessionLike;
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
  // 2-3：框选状态 / 子对话上下文 / 上下文面板 / 自动继承 / 已勾选
  const chatViewRef = useRef<HTMLDivElement>(null);
  const [sel, setSel] = useState<SelectionState | null>(null);
  const [extraContext, setExtraContext] = useState<ContextItemLike[]>(() => contextItems ?? []);
  const [contextOpen, setContextOpen] = useState(false);
  const [autoInherit, setAutoInherit] = useState(false);
  const [checked, setChecked] = useState<Set<string>>(new Set());

  const isSessionMode = session !== null;

  // 会话模式消息 → 对应 session 节点 id（sessionToChatMessages 同序：user/assistant/tool；草稿模式为空）
  const nodeIdByIndex = useMemo(() => {
    const ids: Array<string | undefined> = [];
    for (const n of session?.nodes ?? []) {
      if (n.kind === "user" || n.kind === "assistant" || n.kind === "tool") ids.push(n.id);
    }
    return ids;
  }, [session]);

  // 2-3 agent 下拉选项：已激活且有 hasWorkspace 的驱动（v1 实际只有 minex.agent）
  const agentOptions = useMemo(
    () =>
      kernel.drivers
        .list()
        .filter((m) => m.manifest.hasWorkspace && kernel.drivers.getState(m.manifest.id) === "activated")
        .map((m) => ({ id: m.manifest.id, name: m.manifest.name })),
    [kernel],
  );

  // 2-3 父对话（状态化：2-4 大纲生成后更新，供「添加上上下文」面板实时显示新条目）
  const [parent, setParent] = useState<SessionLike | null>(parentSession ?? null);
  const parentRef = useRef<SessionLike | null>(parent);
  const parentOutlines = (parent?.meta.outlines ?? []) as OutlineLike[];
  const parentFirstMessage = parent?.nodes.find((n) => n.kind === "user")?.content;

  // 卸载时中断进行中的 for await（loop 内检查 cancelledRef）
  useEffect(() => {
    return () => {
      cancelledRef.current = true;
    };
  }, []);

  // 2-3 消息级框选：mouseup 检查 selection 非空且落在消息卡片内（user/assistant 卡带 data-node-id）
  useEffect(() => {
    const onMouseUp = (): void => {
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
        setSel(null);
        return;
      }
      const text = selection.toString().trim();
      if (!text) {
        setSel(null);
        return;
      }
      const anchor = selection.anchorNode;
      const el = anchor instanceof Element ? anchor : (anchor?.parentElement ?? null);
      const container = chatViewRef.current;
      const msgEl = el && container && container.contains(el) ? el.closest(".chat-msg") : null;
      if (!msgEl || !container) {
        setSel(null);
        return;
      }
      const nodeId = msgEl.getAttribute("data-node-id");
      const range = selection.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      const box = container.getBoundingClientRect();
      setSel({ text, nodeId, x: rect.right - box.left + 4, y: rect.bottom - box.top + 4 });
    };
    window.addEventListener("mouseup", onMouseUp);
    return () => window.removeEventListener("mouseup", onMouseUp);
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

  // 打开会话入口：挂载时读暂存 id（App 切驱动竞态桥接）+ 订阅事件（已挂载时切换会话）。
  // sessionProp 直传（2-3 浮窗子对话）不响应全局打开事件——子对话会话由 props 决定。
  useEffect(() => {
    if (sessionProp) return;
    const pending = takePendingOpenSessionId();
    if (pending) void openSession(pending);
    return kernel.events.on("minex:openSession", (payload) => {
      takePendingOpenSessionId(); // 已挂载则直接处理，丢弃暂存防重复打开
      const id = (payload as { id?: string } | undefined)?.id;
      if (id) void openSession(id);
    });
  }, [kernel, openSession, sessionProp]);

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

    // 2) agent.run history = 子对话上下文（contextItems 注入/手动追加）+ buildContext（当前分支，tail 默认 10）
    const history = [
      ...extraContext.map((c) => ({ role: "user" as const, content: c.content })),
      ...tree.buildContext(s2, branchId).map((c) => ({ role: "user" as const, content: c.content })),
    ];
    // 自动继承（2-3）：开关开 → systemPrompt 注入父大纲文本，agent 自行选择
    const systemPrompt = buildChildSystemPrompt(SYSTEM_PROMPT, autoInherit, parentOutlines);

    // 2-4 大纲记忆：子对话 agent-loop 的 onContext hook → 提炼判定 + 生成条目 → 追加父会话大纲 + saveSession
    const onContext = parentRef.current
      ? (ctxItems: Array<{ ref: string; content: string }>): void => {
          if (!shouldOutline(ctxItems)) return; // 空 context 不生成，不污染大纲
          const entry = buildOutlineEntry(ctxItems);
          const p = tree.addOutlineEntry(parentRef.current!, entry);
          parentRef.current = p;
          setParent(p);
          void store.saveSession(p).catch(() => {});
        }
      : undefined;

    const deltas: string[] = [];
    const toolCalls: Array<{ name: string; args: unknown }> = [];
    let errorMsg: string | undefined;
    try {
      for await (const ev of agent.run(systemPrompt, history, undefined, onContext ? { onContext } : undefined)) {
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

  // 2-3：框选 → 创建子会话 + 父会话挂 branch 链接 + emit minex:openChildChat（外壳浮窗承载迷你 ChatView）
  async function openChildChat(text: string, nodeId: string): Promise<void> {
    if (!session || !tree || !store) return;
    setSel(null);
    try {
      const parentBranchId = session.meta.currentBranchId ?? "main";
      const childContext = tree.buildContext(session, parentBranchId, { selectedNodeIds: [nodeId] });
      const childSession = tree.createSession({ title: "子对话", activeAgents: session.activeAgents });
      // 树形关系：父会话挂 branch 链接（from = 子会话 id 跨会话指针，to = 框选节点 = 分支入口）
      const parent2 = tree.addLink(session, { from: childSession.meta.id, to: nodeId, type: "branch" });
      setSession(parent2);
      setMessages(sessionToChatMessages(parent2));
      await store.saveSession(parent2).catch(() => {}); // 无 filesystem 根目录时静默（内存会话仍可用）
      await store.saveSession(childSession).catch(() => {});
      kernel.events.emit("minex:openChildChat", { childSession, contextItems: childContext, parentSession: parent2 });
    } catch {
      /* 打开失败静默，不崩 */
    }
  }

  // 2-3：agent 下拉 → 改子会话 activeAgents + saveSession
  async function selectAgent(driverId: string): Promise<void> {
    if (!session || !store || session.activeAgents[0] === driverId) return;
    const s2 = { ...session, activeAgents: [driverId] };
    setSession(s2);
    await store.saveSession(s2).catch(() => {});
  }

  function toggleChecked(key: string): void {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  // 2-3 人动模式：勾选的大纲条目 / 父初始上下文 → 追加进子对话 history（extraContext）
  function applyContext(): void {
    if (checked.size === 0) return;
    const added: ContextItemLike[] = [];
    for (const key of checked) {
      if (key === "__parent_first__") {
        if (parentFirstMessage !== undefined) added.push({ ref: "parent:first", content: parentFirstMessage });
      } else {
        const o = parentOutlines.find((x) => x.id === key);
        if (o) added.push({ ref: o.id, content: o.summary });
      }
    }
    if (added.length > 0) setExtraContext((prev) => [...prev, ...added]);
    setChecked(new Set());
    setContextOpen(false);
  }

  return (
    <div className="chat-view" ref={chatViewRef}>
      <div className="chat-head">
        {isSessionMode ? (
          <>
            {parentSession && (
              <select
                className="chat-agent-select"
                title="子对话使用的 agent"
                value={session.activeAgents[0] ?? "minex.agent"}
                onChange={(e) => void selectAgent(e.target.value)}
              >
                {agentOptions.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            )}
            <span className="muted">
              {parentSession ? "子对话：" : "会话："}
              {session.meta.title}
            </span>
            {parentSession && (
              <button className="btn-ghost" onClick={() => setContextOpen((o) => !o)}>
                添加上下文
              </button>
            )}
          </>
        ) : (
          messages.length > 0 && (
            <button className="btn-ghost" onClick={() => void saveDraft()}>
              保存为会话
            </button>
          )
        )}
        {saveError && <span className="chat-save-error">{saveError}</span>}
      </div>

      {parentSession && contextOpen && (
        <div className="chat-context-panel">
          <div className="section-title">父对话大纲</div>
          {parentOutlines.length === 0 && parentFirstMessage === undefined && (
            <div className="muted">（父对话暂无大纲或上下文）</div>
          )}
          {parentOutlines.map((o) => (
            <label key={o.id} className="chat-context-item">
              <input type="checkbox" checked={checked.has(o.id)} onChange={() => toggleChecked(o.id)} />
              <span>{o.summary}</span>
            </label>
          ))}
          {parentFirstMessage !== undefined && (
            <label className="chat-context-item">
              <input
                type="checkbox"
                checked={checked.has("__parent_first__")}
                onChange={() => toggleChecked("__parent_first__")}
              />
              <span className="muted">初始上下文：{parentFirstMessage}</span>
            </label>
          )}
          <div className="chat-context-actions">
            <button className="btn" onClick={applyContext} disabled={checked.size === 0}>
              应用
            </button>
            <label className="chat-context-auto">
              <input
                type="checkbox"
                checked={autoInherit}
                onChange={(e) => setAutoInherit(e.target.checked)}
              />
              自动继承
            </label>
          </div>
        </div>
      )}

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
            <div
              key={i}
              className={`chat-msg ${m.role}${m.error ? " error" : ""}`}
              data-node-id={nodeIdByIndex[i]}
            >
              {html ? (
                <div className="markdown-body" dangerouslySetInnerHTML={{ __html: html }} />
              ) : (
                <div>{m.content}</div>
              )}
            </div>
          );
        })}
      </div>

      {/* 2-3 框选浮钮：会话模式 + 选中节点（user/assistant 卡）才出现 */}
      {sel && sel.nodeId && isSessionMode && (
        <button
          className="chat-discuss-btn"
          style={{ left: sel.x, top: sel.y }}
          onClick={() => {
            if (sel.nodeId) void openChildChat(sel.text, sel.nodeId);
          }}
        >
          与 AI 讨论这段
        </button>
      )}

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
