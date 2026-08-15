/**
 * 打开 workflow 编辑器竞态桥接（W-C）：`minex:editWorkflow` 事件由工作流列表发出，
 * App 层先切到 agent 驱动 + 记 editWorkflowId（主区才挂载编辑器面板）——事件先于编辑器挂载，
 * 用模块级暂存把 workflow id 传给挂载后的编辑器（挂载时 take；已挂载时走事件订阅，take 丢弃防重复）。
 */

let pendingEditWorkflowId: string | null = null;

export function setPendingEditWorkflowId(id: string | null): void {
  pendingEditWorkflowId = id;
}

export function takePendingEditWorkflowId(): string | null {
  const id = pendingEditWorkflowId;
  pendingEditWorkflowId = null;
  return id;
}
