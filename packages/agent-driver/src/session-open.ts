/**
 * 打开会话竞态桥接（task 2-2）：`minex:openSession` 事件由会话总览发出，
 * App 层先切到 Agent 驱动（主区才挂载聊天面板）——事件先于 ChatView 挂载，
 * 用模块级暂存把会话 id 传给挂载后的 ChatView（挂载时 take；已挂载时走事件订阅，take 丢弃防重复）。
 */

let pendingOpenSessionId: string | null = null;

/** App 层收到 minex:openSession 时暂存会话 id（切驱动后 ChatView 挂载时读取）。 */
export function setPendingOpenSessionId(id: string | null): void {
  pendingOpenSessionId = id;
}

/** ChatView 挂载时读取并清空暂存 id；返回 null 表示无待打开会话。 */
export function takePendingOpenSessionId(): string | null {
  const id = pendingOpenSessionId;
  pendingOpenSessionId = null;
  return id;
}
