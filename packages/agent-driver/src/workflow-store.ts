/**
 * workflow 存储（W-C）：保存的 workflow 声明式数据（Record<id, Workflow>），
 * 存内核 storage `minex.agent/workflows`；load 损坏容错返回 {}，非法条目跳过。
 */
import type { ChatHistoryKernel } from "./chat-history.js";
import type { Workflow } from "./workflow.js";

/** 形状校验：对象且有 nodes 数组（v1 轻校验，细节由 validateWorkflow 把关） */
export function isWorkflowLike(v: unknown): v is Workflow {
  return typeof v === "object" && v !== null && Array.isArray((v as { nodes?: unknown }).nodes);
}

/** 从原始存储值解析 workflow 表（纯函数，graphSource 经 ctx.storage 直读时复用） */
export function workflowsFromRaw(raw: unknown): Record<string, Workflow> {
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, Workflow> = {};
  for (const [id, v] of Object.entries(raw as Record<string, unknown>)) {
    if (isWorkflowLike(v)) out[id] = v;
  }
  return out;
}

export function loadWorkflows(kernel: ChatHistoryKernel): Record<string, Workflow> {
  try {
    return workflowsFromRaw(kernel.storage.namespace("minex.agent").get("workflows"));
  } catch {
    return {};
  }
}

export function saveWorkflow(kernel: ChatHistoryKernel, id: string, wf: Workflow): void {
  const all = loadWorkflows(kernel);
  all[id] = wf;
  kernel.storage.namespace("minex.agent").set("workflows", all);
}

export function deleteWorkflow(kernel: ChatHistoryKernel, id: string): void {
  const all = loadWorkflows(kernel);
  delete all[id];
  kernel.storage.namespace("minex.agent").set("workflows", all);
}
