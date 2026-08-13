import { buildPlan, type Task } from "./scheduler.js";
import { evalCondition, validateWorkflow, type Workflow, type WorkflowNode } from "./workflow.js";
import type { OperationRegistry } from "./operations.js";

export interface ExecuteWorkflowOptions {
  /** 循环上限（用户/manager 配置传入，不写死） */
  maxLoopIterations: number;
  registry: OperationRegistry;
}

/**
 * 执行工作流：validateWorkflow → 复用 S5f buildPlan（deps 拓扑 + 环检测）→ 逐层逐节点执行。
 * 控制流内建：顺序（deps 分层）、条件（when 满足才执行）、循环（loop 直到 when 不满足或达上限）。
 * 结果按节点 id 返回 Map。天然安全：只查表调用操作，无任意代码路径。
 */
export async function executeWorkflow(
  wf: Workflow,
  ctx: unknown,
  opts: ExecuteWorkflowOptions,
): Promise<Map<string, unknown>> {
  validateWorkflow(wf, opts.registry, { maxLoopIterations: opts.maxLoopIterations });

  const nodeById = new Map(wf.nodes.map((n) => [n.id, n]));
  const tasks: Task<WorkflowNode>[] = wf.nodes.map((n) => ({
    id: n.id,
    deps: n.deps ?? [],
    payload: n,
  }));
  const plan = buildPlan(tasks);
  const results = new Map<string, unknown>();

  for (const step of plan) {
    for (const { task } of step) {
      const node = task.payload;
      if (node.loop) {
        // 循环：when 满足才继续，直到 when 不满足或达上限
        let iter = 0;
        while (iter < opts.maxLoopIterations) {
          if (node.when && !evalCondition(node.when, results)) break;
          results.set(node.id, await opts.registry.execute(node.op, node.args ?? {}, ctx));
          iter++;
        }
      } else {
        // 条件：when 满足才执行，否则跳过
        if (node.when && !evalCondition(node.when, results)) continue;
        results.set(node.id, await opts.registry.execute(node.op, node.args ?? {}, ctx));
      }
    }
  }
  return results;
}
