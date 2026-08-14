import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MinexKernel } from "@minex/kernel";
import {
  AUTO_SAVE_THRESHOLD,
  buildChildSystemPrompt,
  classifyMessage,
  loadAgentConfig,
  loadChatHistory,
  mapContextToMessages,
  newId,
  saveAsSession,
  saveChatHistory,
  sessionToChatMessages,
  shouldAutoSave,
  type AgentConfig,
  type ChatMessageView,
  type MessageClass,
  type SessionLike,
  type SessionLinkLike,
  type SessionNodeLike,
} from "./chat-history.js";
import { buildOutlineEntry, shouldOutline, type OutlineEntryLike } from "./outline.js";
import { takePendingOpenSessionId } from "./session-open.js";
import { QUICK_PHRASES, fillTemplate, type QuickPhrase } from "./quick-phrase.js";
import { checkPermission, type PermissionMode, type ToolRisk } from "./permission.js";
import { resolveToolResult, type ToolExecLike } from "./real-tools.js";
import { BUILTIN_SKILLS, loadAgentProfiles, type AgentProfile } from "./agent-profile.js";

const SYSTEM_PROMPT = "你是一个乐于助人的 AI 助手，用中文回答。";

/** agent 能力子集（宿主视图取能力值要 .value） */
interface AgentCap {
  run(
    systemPrompt: string,
    history: unknown[],
    maxIterations?: number,
    opts?: {
      onContext?: (contextItems: Array<{ ref: string; content: string }>) => void;
      /** 3-1：工具白名单（persona.tools 消费；缺省 = 全部） */
      toolWhitelist?: string[];
      /** 3-2：权限裁决 hook（false → 拒绝文本回灌）；P1-2：call 带 args（ask 弹窗显示目标路径） */
      canRun?: (call: { name: string; risk: string; args?: Record<string, unknown> }) => Promise<boolean>;
      /** 3-3：模型名 / 模型参数覆盖（会话级 settings 消费） */
      model?: string;
      params?: Record<string, unknown>;
      /** 3-4：真停止（AbortController） */
      signal?: AbortSignal;
      /** 3-4：插入指令（每轮 buildMessages 前读取；读后清空） */
      pendingMessages?: () => Array<{ role: string; content: string }>;
    },
  ): AsyncIterable<AgentEvent>;
}

interface AgentEvent {
  kind: "text" | "toolCall" | "done" | "error";
  delta?: string;
  name?: string;
  args?: unknown;
  message?: string;
  /** 3-3：done 事件带用量与费用 */
  usage?: { promptTokens: number; completionTokens: number; cachedTokens: number };
  cost?: number;
}

interface MarkdownCap {
  render(src: string): string;
}

/** session 能力子集（跨包零源码 import，结构类型） */
interface SessionStoreCap {
  hasRoot(): boolean;
  loadSession(id: string): Promise<SessionLike | undefined>;
  saveSession(s: SessionLike): Promise<void>;
  loadIndex(): Promise<{ sessions: Array<{ id: string; title: string }> }>; // G-B 迁移面板来源列表
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
  createSession(input: { title?: string; activeAgents?: string[]; personaId?: string }): SessionLike;
  addOutlineEntry(s: SessionLike, entry: OutlineEntryLike): SessionLike;
  /** 3-4：tool_call 级撤回（删 nodeId 及其 responds 后继） */
  revertAt(s: SessionLike, nodeId: string): { session: SessionLike; removed: SessionNodeLike[] };
  /** 3-4：工具重执行结果插回 */
  redoToolResult(s: SessionLike, node: SessionNodeLike, afterNodeId: string): SessionLike;
  /** F-B 反馈 1：批量插回节点（旧 thinking 恢复） */
  insertNodesAfter(s: SessionLike, nodes: SessionNodeLike[], afterNodeId: string): SessionLike;
}

/** persona 形状（role 贡献值，跨包零源码 import，结构类型） */
interface PersonaLike {
  id: string;
  name: string;
  description?: string;
  systemPrompt: string;
  /** 3-1：工具白名单（缺省 = 全部工具） */
  tools?: string[];
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
  onStateChange,
  selectionText,
}: {
  kernel: MinexKernel;
  instanceId?: number;
  session?: SessionLike;
  contextItems?: ContextItemLike[];
  parentSession?: SessionLike;
  /** P5 状态机句柄上报：dirty（未保存且消息非空）+ save（立即保存），供外壳关闭询问用 */
  onStateChange?: (h: { dirty: boolean; save: () => Promise<void> }) => void;
  /** 2-R1/R-A 框选文本（quick phrase 模板的 {selection} 槽预填） */
  selectionText?: string;
}) {
  // .value 纪律：registry.get 返回 Contribution，能力值在 .value
  const agent = kernel.registry.get<AgentCap>("agent", "default")?.value;
  const md = kernel.registry.get<MarkdownCap>("markdown", "render")?.value;
  const store = kernel.registry.get<SessionStoreCap>("session", "default")?.value;
  const tree = kernel.registry.get<SessionTreeCap>("session.tree", "default")?.value;

  // 2-R1 persona：role 贡献（宿主 .value 纪律）；默认继承父会话 personaId，无则通用助手
  const personas = useMemo<PersonaLike[]>(
    () => kernel.registry.query<PersonaLike>("role").map((c) => c.value),
    [kernel],
  );
  const [personaId, setPersonaId] = useState<string>(
    () => parentSession?.meta.personaId ?? "minex.persona.assistant",
  );
  const currentPersona = personas.find((p) => p.id === personaId);

  // 2-R1/R-A quick phrase 槽位表单（compose 非空时输入行替换为槽位表单；模板经输入区下拉选中展开）
  const [compose, setCompose] = useState<{ phrase: QuickPhrase; values: Record<string, string> } | null>(null);

  const [session, setSession] = useState<SessionLike | null>(sessionProp ?? null);
  // 会话模式：历史来自 session；草稿模式：历史来自 localStorage（刷新不丢）
  const [messages, setMessages] = useState<ChatMessageView[]>(() =>
    sessionProp ? sessionToChatMessages(sessionProp) : loadChatHistory(kernel, instanceId),
  );
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  // 3-2 权限确认弹窗：canRun 裁决为 ask 时挂起，等待用户 允许/拒绝/记住此工具。P1-2：带 args 显示目标路径
  const [permissionPrompt, setPermissionPrompt] = useState<{
    name: string;
    risk: string;
    args?: Record<string, unknown>;
    resolve: (ok: boolean) => void;
  } | null>(null);
  // 3-3 计量：本轮回复用量（回复尾小字）+ 全局累计（metrics 读取节流用 tick）
  const [replyUsage, setReplyUsage] = useState<{ tokens: number; cost: number } | null>(null);
  const [metricsTick, setMetricsTick] = useState(0);
  const cancelledRef = useRef(false);
  const metrics = kernel.registry.get<{ list(): Array<{ cost: number }> }>("llm.metrics", "default")?.value;
  const totalCost = useMemo(
    () => metrics?.list().reduce((s, e) => s + (e.cost ?? 0), 0) ?? 0,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [metrics, metricsTick],
  );
  // 3-4：真停止（AbortController）+ 插入指令（挂起队列）+ tool_call 级撤回/重做
  const abortRef = useRef<AbortController | null>(null);
  const pendingRef = useRef<Array<{ role: string; content: string }>>([]);
  // F-B 反馈 1：read 类工具结果缓存（key = name:JSON.stringify(args)，命中 redo 直接复用不重执行；会话内存态，刷新即失）
  const toolCacheRef = useRef<Map<string, string>>(new Map());
  const [redoState, setRedoState] = useState<{
    toolNode: SessionNodeLike;
    afterNodeId: string;
    staleNodes: SessionNodeLike[]; // F-B：被撤的后续非 tool 节点（旧 thinking，0 token 可恢复）
  } | null>(null);
  // F-B：重做完成后「恢复旧分析」条（staleNodes 非空才显示按钮）
  const [restoreState, setRestoreState] = useState<{
    staleNodes: SessionNodeLike[];
    afterToolId: string;
  } | null>(null);
  // F-A 反馈 2：双击消息行 → 卡片显示全文
  const [detailMsg, setDetailMsg] = useState<ChatMessageView | null>(null);
  // F-A 反馈 4：agent 全局默认配置（内核 storage minex.agent/agentConfig，profile 可覆盖，无则回退现状）
  const agentConfig = loadAgentConfig(kernel);
  // F-C：会话关联的 agent 档案（settings > profile > persona > 全局默认 优先级链的 profile 层）
  const profile: AgentProfile | undefined = (() => {
    const pid = session?.meta.agentProfileId;
    return pid ? loadAgentProfiles(kernel)[pid] : undefined;
  })();
  // 用户反馈（会话设置去重）：会话选了 agent 即继承其 persona——生效 persona 优先级 =
  // 会话 meta.personaId（显式选择/子对话继承）> profile.personaId（agent 档案内嵌）> personaId 状态（默认助手）
  const effectivePersona =
    personas.find((p) => p.id === (session?.meta.personaId ?? profile?.personaId ?? personaId)) ?? currentPersona;

  /** F-A：消息行 icon（tool 🔧 / code </> / think 💭 / user 💬） */
  function msgIcon(cls: MessageClass): string {
    return cls.kind === "tool" ? "🔧" : cls.kind === "code" ? "</>" : cls.kind === "think" ? "💭" : "💬";
  }

  /** F-C：工具白名单 = profile.tools（null=全部）?? 生效 persona 自带 tools（缺省 = 全部） */
  function toolWhitelistOf(): string[] | undefined {
    const t = profile?.tools;
    return t !== undefined ? (t ?? undefined) : effectivePersona?.tools;
  }

  // F-A 反馈 4：Agent 配置面板「设为当前会话 persona」→ 本聊天实例切换
  useEffect(() => {
    return kernel.events.on("minex:setPersona", (payload) => {
      const p = payload as { personaId?: string } | undefined;
      if (!p?.personaId) return;
      setPersonaId(p.personaId);
      setSession((s) => (s ? { ...s, meta: { ...s.meta, personaId: p.personaId! } } : s));
    });
  }, [kernel]);

  // F-A 反馈 2：双击卡片 Esc 关闭
  useEffect(() => {
    if (!detailMsg) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") setDetailMsg(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [detailMsg]);
  // 2-3：框选状态 / 子对话上下文 / 上下文面板 / 自动继承 / 已勾选
  const chatViewRef = useRef<HTMLDivElement>(null);
  const [sel, setSel] = useState<SelectionState | null>(null);
  // G-B 反馈 7：extraContext 独立全新对象（复制，杜绝共享引用——多子对话互不影响）
  const [extraContext, setExtraContext] = useState<ContextItemLike[]>(() => [...(contextItems ?? [])]);
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

  // 2-R1 persona 选择器选项 = registry 全部 role 贡献（P1：浮窗左上角 agent 选择）
  //（原 2-3 的驱动下拉已由 persona 选择取代——用户反馈 1：应为 agent 选择而非驱动选择）

  // 2-3 父对话（状态化：2-4 大纲生成后更新）
  const [parent, setParent] = useState<SessionLike | null>(parentSession ?? null);
  const parentRef = useRef<SessionLike | null>(parent);

  // G-B 反馈 7：迁移面板「来源会话」（任意会话，默认父会话）——大纲勾选加入 context / 自动继承候选
  const [sourceId, setSourceId] = useState<string>(() => parentSession?.meta.id ?? "");
  const [sourceSession, setSourceSession] = useState<SessionLike | null>(() => parentSession ?? null);
  const [sessionEntries, setSessionEntries] = useState<Array<{ id: string; title: string }>>([]);
  useEffect(() => {
    void (async () => {
      if (!store) return;
      const index = await store.loadIndex();
      setSessionEntries(index.sessions.map((e) => ({ id: e.id, title: e.title })));
    })();
  }, [store]);
  const sourceOutlines = (sourceSession?.meta.outlines ?? []) as OutlineLike[];
  const sourceFirstMessage = sourceSession?.nodes.find((n) => n.kind === "user")?.content;

  // P5 保存状态机：会话模式（打开的 .ses）初始已保存；子对话（有 parentSession，草稿优先）初始未保存
  const [saved, setSaved] = useState<boolean>(() => sessionProp !== undefined && parentSession === undefined);
  const savedRef = useRef(saved);
  const sessionRef = useRef<SessionLike | null>(session);
  useEffect(() => {
    savedRef.current = saved;
  }, [saved]);
  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  // P5：立即保存当前会话（子对话 → saveSession 子会话 + 父会话带 branch 链接）+ 状态变 saved
  // 3-6 自动保存原子性：先父后子——父会话先落盘 branch 关系真相源；父失败仍继续子保存
  const saveCurrent = useCallback(async (): Promise<void> => {
    if (savedRef.current) return;
    const s = sessionRef.current;
    if (!s || !store) return;
    if (parentRef.current) await store.saveSession(parentRef.current).catch(() => {});
    await store.saveSession(s).catch(() => {});
    savedRef.current = true;
    setSaved(true);
  }, [store]);

  // P5 关闭询问：dirty = 未保存且消息非空；save 句柄供外壳「保存为会话」用
  useEffect(() => {
    onStateChange?.({ dirty: !saved && messages.length > 0, save: saveCurrent });
  }, [saved, messages, saveCurrent, onStateChange]);

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

  // —— 3-2 权限确认（Promise 桥接：canRun 为 ask 时挂起，等用户选择） ——
  function askPermission(call: { name: string; risk: string; args?: Record<string, unknown> }): Promise<boolean> {
    return new Promise((resolve) => {
      setPermissionPrompt({ name: call.name, risk: call.risk, ...(call.args ? { args: call.args } : {}), resolve });
    });
  }

  /** 3-2「记住此工具」：写 settings.toolPermissions[name]="auto" + saveSession（后续不再弹） */
  async function rememberTool(name: string): Promise<void> {
    if (!session || !store) return;
    const next: SessionLike = {
      ...session,
      meta: {
        ...session.meta,
        settings: {
          ...(session.meta.settings ?? {}),
          toolPermissions: { ...(session.meta.settings?.toolPermissions ?? {}), [name]: "auto" },
        },
      },
    };
    setSession(next);
    await store.saveSession(next).catch(() => {});
  }

  /** 3-2 + F-A/F-C：canRun 裁决模式 = settings ?? profile.permissionMode ?? 全局默认 ?? auto */
  function buildCanRun(): ((call: { name: string; risk: string; args?: Record<string, unknown> }) => Promise<boolean>) | undefined {
    const settings = session?.meta.settings;
    const mode: PermissionMode =
      settings?.permissionMode ?? profile?.permissionMode ?? loadAgentConfig(kernel)?.defaultPermissionMode ?? "auto";
    const overrides = settings?.toolPermissions;
    return async (call) => {
      if (checkPermission({ name: call.name, risk: call.risk as ToolRisk }, mode, overrides) === "allow") return true;
      return await askPermission(call);
    };
  }

  async function sendDraft(text: string): Promise<void> {
    if (!agent) return;
    setReplyUsage(null);
    const userMsg: ChatMessageView = { role: "user", content: text };
    setMessages((prev) => [...prev, userMsg]);
    // history = user/assistant 的 {role, content} 映射（含本轮新消息；error/tool 不进历史）
    const history = [...messages, userMsg]
      .filter((m) => (m.role === "user" || m.role === "assistant") && !m.error)
      .map((m) => ({ role: m.role, content: m.content }));
    // 3-1 + F-C：工具白名单（profile.tools ?? persona.tools；缺省 = 全部工具）；
    // 3-2：权限裁决 canRun；3-4：signal + 插入指令
    const whitelist = toolWhitelistOf();
    const canRun = buildCanRun();
    const runOpts = {
      ...(whitelist && whitelist.length > 0 ? { toolWhitelist: whitelist } : {}),
      ...(canRun ? { canRun } : {}),
      ...(abortRef.current ? { signal: abortRef.current.signal } : {}),
      pendingMessages: (): Array<{ role: string; content: string }> => {
        const p = pendingRef.current;
        pendingRef.current = [];
        return p;
      },
    };
    try {
      for await (const ev of agent.run(SYSTEM_PROMPT, history, undefined, runOpts)) {
        if (cancelledRef.current) break;
        if (ev.kind === "text") {
          setMessages((prev) => appendAssistantDelta(prev, ev.delta ?? ""));
        } else if (ev.kind === "toolCall") {
          setMessages((prev) => [...prev, { role: "tool", content: "", toolName: ev.name, args: ev.args }]);
        } else if (ev.kind === "error") {
          setMessages((prev) => [...prev, { role: "assistant", content: ev.message ?? "发生错误", error: true }]);
        } else if (ev.kind === "done") {
          // 3-3：回复尾用量/费用小字 + 全局累计刷新
          if (ev.usage) {
            setReplyUsage({
              tokens: ev.usage.promptTokens + ev.usage.completionTokens,
              cost: ev.cost ?? 0,
            });
            setMetricsTick((t) => t + 1);
          }
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

    // 1) user 节点 append（responds 到当前分支头）——已保存会话立即落盘；草稿（P5）先留在内存
    const userNode: SessionNodeLike = { id: newId(), kind: "user", content: text, ts: new Date().toISOString() };
    let s2 = tree.addNode(session, userNode);
    if (headNodeId) s2 = tree.addLink(s2, { from: userNode.id, to: headNodeId, type: "responds" });
    setSession(s2);
    setMessages(sessionToChatMessages(s2));
    if (saved) await store.saveSession(s2);

    // 2) agent.run history = 子对话上下文（contextItems 注入/手动追加）+ buildContext（当前分支，tail 默认 10）
    // 3-6：buildContext 产物按 ref 查节点 kind 映射 role（assistant 消息 role:"assistant"，tool/event 跳过）
    const history = [
      ...extraContext.map((c) => ({ role: "user" as const, content: c.content })),
      ...mapContextToMessages(tree.buildContext(s2, branchId), s2),
    ];
    // 2-R1 + R-A 反馈 8 + F-A/F-C：基础 prompt 优先级 =
    // settings.systemPrompt ?? profile.systemPrompt ?? 生效 persona.systemPrompt ?? agent 全局默认 ?? 常量
    const basePrompt =
      session.meta.settings?.systemPrompt ??
      profile?.systemPrompt ??
      effectivePersona?.systemPrompt ??
      loadAgentConfig(kernel)?.defaultSystemPrompt ??
      SYSTEM_PROMPT;
    // G-B 反馈 7：自动继承候选 = 当前来源会话大纲（迁移面板可换来源）
    const systemPrompt =
      buildChildSystemPrompt(basePrompt, autoInherit, sourceOutlines) +
      // F-D：profile.skills 对应 promptBlock 拼接（v1 内置 skill 常量）
      (() => {
        const blocks = (profile?.skills ?? [])
          .map((id) => BUILTIN_SKILLS.find((s) => s.id === id)?.promptBlock)
          .filter((b): b is string => Boolean(b));
        return blocks.length > 0 ? `\n\n${blocks.join("\n\n")}` : "";
      })();

    // 2-4 大纲记忆：子对话 agent-loop 的 onContext hook → 提炼判定 + 生成条目 → 追加父会话大纲 + saveSession。
    // F-D：profile.memory.outlines === false 时禁用大纲生成（开关生效）
    const outlineEnabled = profile?.memory?.outlines !== false;
    const onContext = parentRef.current && outlineEnabled
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
    setReplyUsage(null);
    // 3-1 + F-A/F-C：persona 工具白名单（profile.tools ?? persona.tools）；3-2：canRun；
    // 3-3 + F-C：模型/参数 = settings ?? profile（缺省 = 全局）
    const whitelist = toolWhitelistOf();
    const canRun = buildCanRun();
    const settings = session.meta.settings;
    const runOpts = {
      ...(onContext ? { onContext } : {}),
      ...(whitelist && whitelist.length > 0 ? { toolWhitelist: whitelist } : {}),
      ...(canRun ? { canRun } : {}),
      ...(settings?.model ?? profile?.model ? { model: settings?.model ?? profile?.model } : {}),
      ...(settings?.temperature !== undefined || profile?.params?.temperature !== undefined
        ? {
            params: {
              temperature:
                settings?.temperature ?? (profile?.params?.temperature as number | undefined),
            },
          }
        : {}),
      ...(abortRef.current ? { signal: abortRef.current.signal } : {}),
      pendingMessages: (): Array<{ role: string; content: string }> => {
        const p = pendingRef.current;
        pendingRef.current = [];
        return p;
      },
    };
    try {
      for await (const ev of agent.run(systemPrompt, history, undefined, runOpts)) {
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
          // 3-3：回复尾用量/费用小字 + 全局累计刷新
          if (ev.usage) {
            setReplyUsage({
              tokens: ev.usage.promptTokens + ev.usage.completionTokens,
              cost: ev.cost ?? 0,
            });
            setMetricsTick((t) => t + 1);
          }
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
    // 3b) P5 自动保存状态机：已保存 → 每轮落盘；未保存（子对话草稿）→ 轮数（用户消息数）达阈值自动保存
    // 3-6 原子性：先父后子（父会话先落盘 branch 关系真相源；父失败仍继续子保存）
    if (saved) {
      await store.saveSession(s3);
    } else if (
      shouldAutoSave(s3.nodes.filter((n) => n.kind === "user").length, AUTO_SAVE_THRESHOLD)
    ) {
      if (parentRef.current) await store.saveSession(parentRef.current).catch(() => {});
      await store.saveSession(s3).catch(() => {});
      savedRef.current = true;
      setSaved(true);
    }
  }

  async function send(textOverride?: string): Promise<void> {
    const text = (textOverride ?? input).trim();
    if (!text || !agent) return;
    if (textOverride === undefined) setInput("");
    // 3-4 插入指令：流式/工具执行期间发送不禁用——push 消息 + 挂起队列（不 abort），
    // 工具结果回灌后下一轮 LLM 自动带上（「tool_call 结束后优先处理用户插入」）
    if (streaming) {
      const inserted: ChatMessageView = { role: "user", content: text };
      setMessages((prev) => [...prev, inserted]);
      pendingRef.current.push({ role: "user", content: text });
      return;
    }
    setStreaming(true);
    cancelledRef.current = false;
    abortRef.current = new AbortController();
    if (isSessionMode) await sendSessionMode(text);
    else await sendDraft(text);
    abortRef.current = null;
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

  // 2-3/2-R1：框选 → 子对话草稿（P5 draft-first：不立即建 .ses，≥3 轮自动保存 / 关闭时询问）+ 父会话挂 branch 链接
  // R-A 反馈 4：quick phrase 模板已移入浮窗输入区（不再经框选浮钮打开槽位表单）
  async function openChildChat(text: string, nodeId: string): Promise<void> {
    if (!session || !tree || !store) return;
    setSel(null);
    try {
      const parentBranchId = session.meta.currentBranchId ?? "main";
      // R-B 反馈 7：子对话默认只继承框选内容（tailCount=0，不复制父链 tail 全文——父链上下文按需经「添加上下文」补充）
      const childContext = tree.buildContext(session, parentBranchId, { selectedNodeIds: [nodeId], tailCount: 0 });
      // 2-R1：子会话继承父 persona（P1）；子会话记父会话 id（P3）；父会话挂 branch 链接（from = 子会话 id，to = 框选节点）
      const created = tree.createSession({
        title: "子对话",
        activeAgents: session.activeAgents,
        ...(session.meta.personaId ? { personaId: session.meta.personaId } : {}),
      });
      const childSession = {
        ...created,
        meta: {
          ...created.meta,
          parentSessionId: session.meta.id,
          // F-C：子会话继承父会话的 agent 档案
          ...(session.meta.agentProfileId ? { agentProfileId: session.meta.agentProfileId } : {}),
        },
      };
      const parent2 = tree.addLink(session, { from: childSession.meta.id, to: nodeId, type: "branch" });
      setSession(parent2);
      setMessages(sessionToChatMessages(parent2));
      // 不立即 saveSession——子对话为草稿，自动保存（≥3 轮）/关闭询问时落盘
      kernel.events.emit("minex:openChildChat", {
        childSession,
        contextItems: childContext,
        parentSession: parent2,
        selectionText: text, // R-A 反馈 4：模板移入浮窗内，{selection} 槽预填框选文本
      });
    } catch {
      /* 打开失败静默，不崩 */
    }
  }

  // 2-R1：persona 选择 → 子会话 meta.personaId 更新（内存态，自动保存/关闭保存时落盘）
  function selectPersona(id: string): void {
    setPersonaId(id);
    setSession((s) => (s ? { ...s, meta: { ...s.meta, personaId: id } } : s));
  }

  // 2-R1：quick phrase 槽位表单提交 → fillTemplate 产物为首条 user 消息
  function submitCompose(): void {
    if (!compose) return;
    const text = fillTemplate(compose.phrase, compose.values).trim();
    if (!text) return;
    setCompose(null);
    void send(text);
  }

  // 2-R1：浮窗展开为新工作区（P6）——emit 后外壳 addInstance + 新实例会话模式打开。
  // G-B 反馈 1：展开前 saveIfNeeded（草稿先落盘，防「展开即丢」）；保存失败 → 提示且不展开。
  async function expandToWorkspace(): Promise<void> {
    if (!session) return;
    if (!savedRef.current) {
      await saveCurrent().catch(() => {});
      if (!savedRef.current) {
        setSaveError("保存失败（可能未选择文件夹），未展开");
        return;
      }
    }
    kernel.events.emit("minex:expandToWorkspace", {
      sessionId: session.meta.id,
      branchId: session.meta.currentBranchId ?? "main",
      personaId,
    });
  }

  // 2-3：agent 下拉 → 改子会话 activeAgents + saveSession
  async function selectAgent(driverId: string): Promise<void> {
    if (!session || !store || session.activeAgents[0] === driverId) return;
    const s2 = { ...session, activeAgents: [driverId] };
    setSession(s2);
    await store.saveSession(s2).catch(() => {});
  }

  // —— 3-4/F-B tool_call 级撤回/重做（基元化，不整轮重跑） ——
  /** 撤回：删该 tool 节点及其 responds 后继（含其后 thinking）；被撤 tool + 链上前驱 + 旧 thinking 存 redoState */
  async function revertTo(nodeId: string | undefined): Promise<void> {
    if (!nodeId || !session || !tree || !store) return;
    const orig = session;
    const { session: s2, removed } = tree.revertAt(orig, nodeId);
    if (removed.length === 0) return;
    const toolNode = removed.find((n) => n.id === nodeId && n.kind === "tool");
    const afterNodeId = toolNode
      ? orig.links.find((l) => l.type === "responds" && l.from === toolNode.id)?.to
      : undefined;
    setRestoreState(null);
    setRedoState(
      toolNode && afterNodeId
        ? {
            toolNode,
            afterNodeId,
            staleNodes: removed.filter((n) => n.id !== nodeId && n.kind !== "tool"), // F-B：旧 thinking
          }
        : null,
    );
    setSession(s2);
    setMessages(sessionToChatMessages(s2));
    await store.saveSession(s2).catch(() => {});
  }

  /** 重做：read 类工具命中缓存直接复用（不重执行）；write/run 必重跑。结果插回（不重新生成后续 thinking） */
  async function redoTool(): Promise<void> {
    if (!redoState || !session || !tree || !store) return;
    const toolName = redoState.toolNode.toolName ?? "";
    const tools = kernel.registry
      .query<{ name: string; risk?: string; execute(args: Record<string, unknown>): Promise<string> }>("tool")
      .map((c) => c.value);
    const tool = tools.find((t) => t.name === toolName);
    if (!tool) return;
    const canRun = buildCanRun();
    if (canRun && !(await canRun({ name: toolName, risk: tool.risk ?? "read" }))) return; // 拒绝 → 不重做
    const args = (redoState.toolNode.input ?? {}) as Record<string, unknown>;
    // P1-4：resolveToolResult——read 类命中缓存直接复用（不重执行）；write/run 必重跑
    const output = await resolveToolResult(tool as ToolExecLike, args, toolCacheRef.current);
    const updated: SessionNodeLike = { ...redoState.toolNode, output, error: undefined };
    const s2 = tree.redoToolResult(session, updated, redoState.afterNodeId);
    // F-B：重做完成 → 显示「恢复旧分析」条（0 token 复用旧 thinking）
    setRestoreState({ staleNodes: redoState.staleNodes, afterToolId: updated.id });
    setRedoState(null);
    setSession(s2);
    setMessages(sessionToChatMessages(s2));
    await store.saveSession(s2).catch(() => {});
  }

  /** F-B：恢复旧分析（0 token）——把被撤的后续 thinking 批量插回新工具结果之后（用户自行判断相关性） */
  async function restoreStale(): Promise<void> {
    if (!restoreState || !session || !tree || !store) return;
    if (restoreState.staleNodes.length === 0) return;
    const s2 = tree.insertNodesAfter(session, restoreState.staleNodes, restoreState.afterToolId);
    setRestoreState(null);
    setSession(s2);
    setMessages(sessionToChatMessages(s2));
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
  // R-B 反馈 7：按 ref 去重——同一节点/条目多次勾选只进一次
  function applyContext(): void {
    if (checked.size === 0) return;
    const added: ContextItemLike[] = [];
    for (const key of checked) {
      if (key === "__source_first__") {
        if (sourceFirstMessage !== undefined) added.push({ ref: `first:${sourceId}`, content: sourceFirstMessage });
      } else {
        const o = sourceOutlines.find((x) => x.id === key);
        if (o) added.push({ ref: o.id, content: o.summary });
      }
    }
    if (added.length > 0) {
      setExtraContext((prev) => {
        const existing = new Set(prev.map((c) => c.ref));
        const fresh = added.filter((c) => !existing.has(c.ref));
        return fresh.length > 0 ? [...prev, ...fresh] : prev;
      });
    }
    setChecked(new Set());
    setContextOpen(false);
  }

  // G-B 反馈 7：迁移面板来源切换（任意会话；切换后勾选重置）
  async function selectSource(id: string): Promise<void> {
    setSourceId(id);
    setChecked(new Set());
    if (!store) return;
    const s = await store.loadSession(id);
    setSourceSession(s ?? null);
  }

  return (
    <div className="chat-view" ref={chatViewRef}>
      <div className="chat-head">
        {isSessionMode ? (
          <>
            {parentSession && (
              <select
                className="chat-agent-select"
                title="选择 agent（persona）"
                value={personaId}
                onChange={(e) => selectPersona(e.target.value)}
              >
                {personas.map((p) => (
                  <option key={p.id} value={p.id} title={p.description}>
                    {p.name}
                  </option>
                ))}
              </select>
            )}
            <span className="muted">
              {parentSession ? "子对话：" : "会话："}
              {session.meta.title}
            </span>
            {parentSession && (
              <>
                <button className="btn-ghost" onClick={() => setContextOpen((o) => !o)}>
                  添加上下文
                </button>
                <button className="chat-expand-btn" title="展开为新工作区" onClick={() => void expandToWorkspace()}>
                  ↗
                </button>
              </>
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
          <div className="section-title">来源会话（任意会话，默认父会话）</div>
          <select
            className="chat-agent-select"
            title="迁移面板来源会话"
            value={sourceId}
            onChange={(e) => void selectSource(e.target.value)}
          >
            {sessionEntries.map((e) => (
              <option key={e.id} value={e.id}>
                {e.title}
              </option>
            ))}
          </select>
          <div className="section-title">大纲</div>
          {sourceOutlines.length === 0 && sourceFirstMessage === undefined && (
            <div className="muted">（该会话暂无大纲或上下文）</div>
          )}
          {sourceOutlines.map((o) => (
            <label key={o.id} className="chat-context-item">
              <input type="checkbox" checked={checked.has(o.id)} onChange={() => toggleChecked(o.id)} />
              <span>{o.summary}</span>
            </label>
          ))}
          {sourceFirstMessage !== undefined && (
            <label className="chat-context-item">
              <input
                type="checkbox"
                checked={checked.has("__source_first__")}
                onChange={() => toggleChecked("__source_first__")}
              />
              <span className="muted">初始上下文：{sourceFirstMessage}</span>
            </label>
          )}
          <div className="chat-context-actions">
            <button className="btn" onClick={applyContext} disabled={checked.size === 0}>
              加入当前 context
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
          // P0-1：user/assistant 全文渲染（给人读）；仅 tool 类折叠成一行 icon+摘要 + 双击卡片看全量
          if (m.role === "tool") {
            const cls = classifyMessage(m);
            const isToolError = (m.content ?? "").startsWith("Error");
            return (
              <div
                key={i}
                className={`chat-msg chat-msg-line tool${m.error ? " error" : ""}`}
                data-node-id={nodeIdByIndex[i]}
                title="双击查看全文"
                onDoubleClick={() => setDetailMsg(m)}
              >
                <span className="chat-msg-icon">🔧</span>
                <span className={`chat-msg-summary${isToolError ? " error" : ""}`}>{cls.summary}</span>
                {/* 3-4：tool_call 级撤回（删除该工具及其后节点，不整轮重跑）——保留在 tool 行内 */}
                {isSessionMode && (
                  <button
                    className="chat-tool-revert"
                    title="撤回到此（删除该工具及其后节点）"
                    onClick={() => void revertTo(nodeIdByIndex[i])}
                  >
                    ↩
                  </button>
                )}
              </div>
            );
          }
          // P0-1：user/assistant 全文渲染（user pre-wrap / assistant markdown）
          const html = m.role === "assistant" && md && m.content ? md.render(m.content) : null;
          return (
            <div
              key={i}
              className={`chat-msg ${m.role}${m.error ? " error" : ""}`}
              data-node-id={nodeIdByIndex[i]}
              title="双击查看全文"
              onDoubleClick={() => setDetailMsg(m)}
            >
              {html ? (
                <div className="markdown-body" dangerouslySetInnerHTML={{ __html: html }} />
              ) : (
                <div className="chat-msg-text">{m.content}</div>
              )}
            </div>
          );
        })}
        {/* 3-3：回复尾用量/费用小字（done 事件） */}
        {replyUsage && (
          <div className="chat-usage muted">
            ↑ {replyUsage.tokens} tokens · ${replyUsage.cost.toFixed(4)}
          </div>
        )}
      </div>

      {/* F-A 反馈 2：双击消息 → 卡片显示全文（tool = 完整 args JSON + 输出；assistant = markdown 渲染） */}
      {detailMsg && (
        <div className="floating-mask" onClick={() => setDetailMsg(null)}>
          <div className="chat-msg-card" onClick={(e) => e.stopPropagation()}>
            <div className="chat-msg-card-head">
              <span className="chat-msg-icon">{msgIcon(classifyMessage(detailMsg))}</span>
              <span className="chat-msg-card-summary">{classifyMessage(detailMsg).summary}</span>
              <button className="icon-btn" title="关闭" onClick={() => setDetailMsg(null)}>
                ×
              </button>
            </div>
            <div className="chat-msg-card-body">
              {detailMsg.role === "tool" ? (
                <>
                  {detailMsg.args !== undefined && (
                    <pre className="chat-tool-args">{JSON.stringify(detailMsg.args, null, 2)}</pre>
                  )}
                  {detailMsg.content !== "" && <div className="muted">输出：{detailMsg.content}</div>}
                </>
              ) : detailMsg.role === "assistant" && md && detailMsg.content ? (
                <div className="markdown-body" dangerouslySetInnerHTML={{ __html: md.render(detailMsg.content) }} />
              ) : (
                <div style={{ whiteSpace: "pre-wrap" }}>{detailMsg.content}</div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 3-4/F-B：被撤区重做条（v1 redo 栈内存态，刷新即失）——仅重跑该工具，不重新生成后续 thinking */}
      {redoState && (
        <div className="chat-redo-bar">
          <span className="muted">
            已撤回工具调用 {redoState.toolNode.toolName ?? "?"}（其后节点已移除）
          </span>
          <button className="btn-ghost" onClick={() => void redoTool()}>
            重做（仅重跑该工具）
          </button>
        </div>
      )}
      {/* F-B：重做完成 → 恢复旧分析（0 token 复用旧 thinking，用户自行判断） */}
      {restoreState && (
        <div className="chat-redo-bar">
          <span className="muted">重做完成（仅重跑该工具，未重新生成后续）</span>
          {restoreState.staleNodes.length > 0 && (
            <button className="btn-ghost" onClick={() => void restoreStale()}>
              恢复旧分析（0 token）
            </button>
          )}
        </div>
      )}

      {/* 2-3/2-R1 框选浮钮菜单：会话模式 + 选中节点（user/assistant 卡）才出现——
          「与 AI 讨论这段」+ 3 个 quick phrase 模板 */}
      {/* 2-3/2-R1 框选浮钮：会话模式 + 选中节点（user/assistant 卡）才出现——R-A 反馈 4：只留「与 AI 讨论这段」，
          quick phrase 模板已移入浮窗输入区（模板下拉） */}
      {sel && sel.nodeId && isSessionMode && (
        <div className="chat-discuss-menu" style={{ left: sel.x, top: sel.y }}>
          <button
            className="chat-discuss-btn"
            onClick={() => {
              if (sel.nodeId) void openChildChat(sel.text, sel.nodeId);
            }}
          >
            与 AI 讨论这段
          </button>
        </div>
      )}

      {/* 3-3：全局累计（全部会话，llm.metrics 求和） */}
      <div className="chat-total muted">全局累计（全部会话）：${totalCost.toFixed(4)}</div>

      {compose ? (
        /* 2-R1/R-A quick phrase 槽位表单：{selection} 槽可编辑（框选自动填入，手动模板可自填），其余槽位输入 */
        <div className="chat-compose">
          <div className="chat-compose-title muted">模板：{compose.phrase.title}</div>
          {compose.phrase.slots.map((slot) => (
            <label key={slot.key} className="chat-compose-field">
              <span>{slot.label}</span>
              <input
                value={compose.values[slot.key] ?? ""}
                placeholder={slot.placeholder ?? (slot.key === "selection" ? "粘贴或输入内容" : undefined)}
                onChange={(e) =>
                  setCompose((c) => (c ? { ...c, values: { ...c.values, [slot.key]: e.target.value } } : c))
                }
              />
            </label>
          ))}
          <div className="chat-compose-actions">
            <button className="btn-ghost" onClick={() => setCompose(null)}>
              取消
            </button>
            <button className="btn" onClick={submitCompose}>
              发送
            </button>
          </div>
        </div>
      ) : (
        <div className="chat-input-row">
          {/* R-A 反馈 4：quick phrase 模板下拉（选中展开槽位表单；不选 = 普通输入） */}
          <select
            className="chat-phrase-select"
            title="quick phrase 模板"
            value=""
            onChange={(e) => {
              const q = QUICK_PHRASES.find((x) => x.id === e.target.value);
              if (!q) return;
              setCompose({
                phrase: q,
                values: {
                  selection: selectionText ?? "",
                  ...Object.fromEntries(q.slots.filter((s) => s.key !== "selection").map((s) => [s.key, ""])),
                },
              });
            }}
          >
            <option value="">+ 模板</option>
            {QUICK_PHRASES.map((q) => (
              <option key={q.id} value={q.id}>
                {q.title}
              </option>
            ))}
          </select>
          <input
            value={input}
            placeholder="输入消息…（流式中可插入指令，工具结果回灌后优先处理）"
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void send();
            }}
          />
          {/* 3-4：流式中发送按钮原位变「停止」（真停止：abort 全链，不报错） */}
          {streaming ? (
            <button
              className="btn"
              onClick={() => {
                abortRef.current?.abort();
                cancelledRef.current = true;
                setStreaming(false);
              }}
            >
              停止
            </button>
          ) : (
            <button className="btn" onClick={() => void send()} disabled={input.trim() === ""}>
              发送
            </button>
          )}
        </div>
      )}

      {/* 3-2 权限确认弹窗：工具执行需许可（manual 的 write/run 或 edit 的 run；点遮罩 = 拒绝） */}
      {permissionPrompt && (
        <div
          className="floating-mask"
          onClick={() => {
            permissionPrompt.resolve(false);
            setPermissionPrompt(null);
          }}
        >
          <div className="confirm-box" onClick={(e) => e.stopPropagation()}>
            <p>
              执行 <strong>{permissionPrompt.name}</strong>
              {typeof permissionPrompt.args?.path === "string" && permissionPrompt.args.path
                ? ` → ${permissionPrompt.args.path}`
                : ""}
              （{permissionPrompt.risk}）需要你的许可。
            </p>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 12 }}>
              <button
                className="btn-ghost"
                onClick={() => {
                  permissionPrompt.resolve(false);
                  setPermissionPrompt(null);
                }}
              >
                拒绝
              </button>
              <button
                className="btn-ghost"
                onClick={() => {
                  void rememberTool(permissionPrompt.name).then(() => {
                    permissionPrompt.resolve(true);
                    setPermissionPrompt(null);
                  });
                }}
              >
                记住此工具
              </button>
              <button
                className="btn"
                onClick={() => {
                  permissionPrompt.resolve(true);
                  setPermissionPrompt(null);
                }}
              >
                允许
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
