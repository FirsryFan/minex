/**
 * 聊天历史持久化与迁移纯函数（task 1-3）。
 * 存储：内核 storage 命名空间 "minex.agent"，key = `chatHistory@<instanceId>`（阶段 2 会话隔离预留）。
 * D11 定案：localStorage 落盘（刷新不丢）；chatMessagesToSession 为阶段 2 迁移预留。
 */

/** UI 消息结构（流式聊天视图消费） */
export interface ChatMessageView {
  role: "user" | "assistant" | "tool";
  content: string;
  toolName?: string;
  args?: unknown;
  /** error 事件渲染为红色错误消息（非对话内容，不进后续 history 映射） */
  error?: boolean;
}

/** kernel 最小结构（chat-history 只用 storage） */
export interface ChatHistoryKernel {
  storage: {
    namespace(name: string): {
      get<T = unknown>(key: string): T | undefined;
      set<T = unknown>(key: string, value: T): void;
    };
  };
}

function chatKey(instanceId: number | undefined): string {
  return `chatHistory@${instanceId ?? 0}`;
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
 * 阶段 2 迁移预留：ChatMessageView[] → Session 节点/链接结构。
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
