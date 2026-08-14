/**
 * 聊天历史持久化与迁移纯函数（task 1-3 / 2-2）。
 * - 草稿（1-3）：localStorage 落盘（D11：刷新不丢），key = `chatHistory@<instanceId>`。
 * - 会话（2-2）：session = 唯一真相源（.ses 节点 append）；chatMessagesToSession / sessionToChatMessages 互为逆过程。
 * 跨包约定：Session 形状用结构类型本地声明（跨包零源码 import，session-driver 的 SessionFsOps 同模式）；
 * 运行时的树纯函数（buildContext/addNode/addLink）经 `session.tree` 能力桥接。
 */

/** Session 形状结构类型（与 session-driver 的 Session 结构一致，跨包零源码 import） */
export interface SessionLike {
  meta: {
    id: string;
    type: string;
    title: string;
    tags: string[];
    createdAt: string;
    updatedAt: string;
    currentBranchId?: string;
    outlines?: unknown[];
    settings?: {
      model?: string;
      temperature?: number;
      contextStrategy?: string;
      systemPrompt?: string; // R-A 反馈 8：会话级自定义提示词
      /** 3-2 权限模式（auto/edit/manual）与按工具覆盖 */
      permissionMode?: "auto" | "edit" | "manual";
      toolPermissions?: Record<string, "auto" | "edit" | "manual">;
    };
    parentSessionId?: string;
    personaId?: string;
    /** F-C：会话关联的 agent 档案 id（AgentProfile） */
    agentProfileId?: string;
  };
  activeAgents: string[];
  nodes: SessionNodeLike[];
  links: SessionLinkLike[];
}

export interface SessionNodeLike {
  id: string;
  kind: string;
  agentId?: string;
  content?: string;
  toolName?: string;
  input?: unknown;
  output?: unknown;
  error?: string;
  ts: string;
}

export interface SessionLinkLike {
  from: string;
  to: string;
  type: string;
}

/** UI 消息结构（流式聊天视图消费） */
export interface ChatMessageView {
  role: "user" | "assistant" | "tool";
  content: string;
  toolName?: string;
  args?: unknown;
  /** error 事件渲染为红色错误消息（非对话内容，不进后续 history 映射） */
  error?: boolean;
}

/** kernel 最小结构（chat-history 只用 storage + registry 取 session 能力） */
export interface ChatHistoryKernel {
  storage: {
    namespace(name: string): {
      get<T = unknown>(key: string): T | undefined;
      set<T = unknown>(key: string, value: T): void;
    };
  };
  registry: {
    get<T = unknown>(type: string, id: string): { value: T } | undefined;
  };
}

/** session 能力最小结构（结构类型，跨包零源码 import） */
export interface SessionStoreLike {
  hasRoot(): boolean;
  loadSession(id: string): Promise<SessionLike | undefined>;
  saveSession(s: SessionLike): Promise<void>;
}

/** agent 配置（F-A 反馈 4，内核 storage `minex.agent/agentConfig`）：默认权限/默认 prompt（全局缺省，F-C profile 可覆盖） */
export interface AgentConfig {
  /** 默认权限模式（会话 settings.permissionMode / profile.permissionMode 缺省时回退；再回退 "auto"） */
  defaultPermissionMode?: "auto" | "edit" | "manual";
  /** 默认 systemPrompt（会话 settings.systemPrompt / profile.systemPrompt / persona.systemPrompt 均无时回退） */
  defaultSystemPrompt?: string;
}

export function loadAgentConfig(kernel: ChatHistoryKernel): AgentConfig | undefined {
  return kernel.storage.namespace("minex.agent").get<AgentConfig>("agentConfig");
}

export function saveAgentConfig(kernel: ChatHistoryKernel, config: AgentConfig): void {
  kernel.storage.namespace("minex.agent").set("agentConfig", config);
}

function chatKey(instanceId: number | undefined): string {
  return `chatHistory@${instanceId ?? 0}`;
}

/** 新节点/会话 id（时间戳 + 随机后缀）。 */
export function newId(): string {
  return `s-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * 子对话 systemPrompt（2-3 自动继承）：开关开且有父大纲 → 基础 prompt + 大纲文本补充
 * （让 agent 自己从大纲选择相关信息，D10 3.4）；否则原样返回基础 prompt。
 */
export function buildChildSystemPrompt(
  base: string,
  autoInherit: boolean,
  outlines: Array<{ summary: string }>,
): string {
  if (!autoInherit || outlines.length === 0) return base;
  const list = outlines.map((o) => `- ${o.summary}`).join("\n");
  return `${base}\n\n以下是父对话的大纲记忆，可从中选择与本次对话相关的信息：\n${list}`;
}

/** 自动保存阈值（P5 拍板：子对话 ≥3 轮自动保存；v1 常量，不做 UI 配置） */
export const AUTO_SAVE_THRESHOLD = 3;

/** 消息分类结果（F-A 反馈 2：一行 icon + 摘要，不展示整段 JSON/代码） */
export interface MessageClass {
  kind: "tool" | "code" | "think" | "user";
  summary: string;
}

/**
 * 消息分类（F-A 反馈 2，纯函数）：tool→扳手（工具名 + 首参键=值截断 40 字）；
 * assistant 含 ``` → code（编写代码，首行截断 60 字）；assistant 其他 → think（首行截断 60 字）；
 * user → 首行截断 60 字。空内容 → 空摘要。
 */
export function classifyMessage(m: ChatMessageView): MessageClass {
  if (m.role === "tool") {
    const args = m.args as Record<string, unknown> | undefined;
    const first =
      args && typeof args === "object" && !Array.isArray(args)
        ? Object.entries(args)
            .slice(0, 1)
            .map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`)[0]
        : "";
    return { kind: "tool", summary: `调用工具 ${m.toolName ?? "?"}${first ? `（${first.slice(0, 40)}）` : ""}` };
  }
  const content = m.content ?? "";
  if (m.role === "user") {
    return { kind: "user", summary: (content.split("\n")[0] || "").slice(0, 60) };
  }
  const firstLine = (content.split("\n")[0] || "").slice(0, 60);
  if (content.includes("```")) return { kind: "code", summary: firstLine };
  return { kind: "think", summary: firstLine };
}

/**
 * 3-6：buildContext 产物 → LLM history 消息（按 ref 查节点 kind 映射 role，不动 buildContext）。
 * ref = 节点 id → 查 kind：user→"user" / assistant→"assistant"；tool/event 等跳过；
 * ref 非节点 id（如 "parent:tail"）或节点不存在 → 按 "user"（内容来源默认视为用户输入，兼容旧行为）。
 */
export function mapContextToMessages(
  contextItems: Array<{ ref: string; content: string }>,
  session: SessionLike,
): Array<{ role: "user" | "assistant"; content: string }> {
  const byId = new Map(session.nodes.map((n) => [n.id, n]));
  const out: Array<{ role: "user" | "assistant"; content: string }> = [];
  for (const c of contextItems) {
    const node = byId.get(c.ref);
    if (!node) {
      out.push({ role: "user", content: c.content });
      continue;
    }
    if (node.kind === "user" || node.kind === "assistant") {
      out.push({ role: node.kind, content: c.content });
    }
    // tool / event / agent-msg 跳过
  }
  return out;
}

/**
 * 自动保存判定（P5 状态机）：messageCount ≥ threshold 且 threshold > 0。
 * messageCount 语义 = 轮数（用户消息数）；threshold ≤ 0 视为关闭自动保存（防御）。
 */
export function shouldAutoSave(messageCount: number, threshold: number): boolean {
  return threshold > 0 && messageCount >= threshold;
}

/** 读取聊天历史：JSON.parse，缺失/损坏返回 []（try/catch 不抛错）。 */
export function loadChatHistory(kernel: ChatHistoryKernel, instanceId: number | undefined): ChatMessageView[] {
  try {
    const raw = kernel.storage.namespace("minex.agent").get<string>(chatKey(instanceId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as ChatMessageView[]) : [];
  } catch {
    return [];
  }
}

/** 写入聊天历史：JSON.stringify 存同 key。 */
export function saveChatHistory(
  kernel: ChatHistoryKernel,
  instanceId: number | undefined,
  messages: ChatMessageView[],
): void {
  kernel.storage.namespace("minex.agent").set(chatKey(instanceId), JSON.stringify(messages));
}

/**
 * 阶段 2 迁移/持久化：ChatMessageView[] → Session 节点/链接结构。
 * user/assistant → { kind, content }；tool → { kind, toolName, input: args, output: content }；
 * 线性 responds 链接（i → i-1）。id 用自增 msg-<i>；ts 用当前时间。
 */
export function chatMessagesToSession(messages: ChatMessageView[]): { nodes: unknown[]; links: unknown[] } {
  const ts = new Date().toISOString();
  const nodes: unknown[] = [];
  const links: unknown[] = [];
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    const id = `msg-${i}`;
    if (m.role === "tool") {
      nodes.push({ id, kind: "tool", toolName: m.toolName, input: m.args, output: m.content, ts });
    } else {
      nodes.push({ id, kind: m.role, content: m.content, ts });
    }
    if (i > 0) links.push({ from: id, to: `msg-${i - 1}`, type: "responds" });
  }
  return { nodes, links };
}

/**
 * chatMessagesToSession 的逆过程：Session 节点 → ChatMessageView[]（2-2 会话模式渲染历史）。
 * user/assistant → { role, content }；tool → { role:"tool", content: output, toolName, args: input }；
 * agent-msg / event 等未知节点类型不渲染为聊天消息。
 */
export function sessionToChatMessages(session: SessionLike): ChatMessageView[] {
  const out: ChatMessageView[] = [];
  for (const n of session.nodes) {
    if (n.kind === "user" || n.kind === "assistant") {
      out.push({ role: n.kind, content: n.content ?? "" });
    } else if (n.kind === "tool") {
      out.push({
        role: "tool",
        content: n.output !== undefined ? String(n.output) : "",
        toolName: n.toolName,
        args: n.input,
      });
    }
  }
  return out;
}

/**
 * 草稿 → 会话（2-2）：chatMessagesToSession 产物包装成 Session（type "chat"、activeAgents ["minex.agent"]）
 * → session 能力 saveSession（.value 纪律）→ 调用方清空草稿（chatHistory）。
 * 无 session 能力 / 无 filesystem 根目录 → 抛错（UI 提示，不崩）。
 */
export async function saveAsSession(
  kernel: ChatHistoryKernel,
  messages: ChatMessageView[],
  title?: string,
): Promise<void> {
  const store = kernel.registry.get<SessionStoreLike>("session", "default")?.value;
  if (!store) throw new Error("未找到 session 能力");
  if (!store.hasRoot()) throw new Error("请先选择文件夹以启用会话保存");
  const { nodes, links } = chatMessagesToSession(messages);
  const now = new Date().toISOString();
  const session: SessionLike = {
    meta: {
      id: newId(),
      type: "chat",
      title: title ?? "新会话",
      tags: [],
      createdAt: now,
      updatedAt: now,
    },
    activeAgents: ["minex.agent"],
    nodes: nodes as SessionNodeLike[],
    links: links as SessionLinkLike[],
  };
  await store.saveSession(session);
}
