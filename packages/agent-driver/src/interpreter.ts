import { buildPlan, type Task } from "./scheduler.js";
import { evalCondition, validateWorkflow, type Workflow, type WorkflowNode } from "./workflow.js";
import type { OperationRegistry } from "./operations.js";

export interface ExecuteWorkflowOptions {
  /** 循环上限（用户/manager 配置传入，不写死） */
  maxLoopIterations: number;
  registry: OperationRegistry;
  /** 解释器层兜底上限（默认 1000，双层上限） */
  absoluteMaxIterations?: number;
}

const DEFAULT_ABSOLUTE_MAX = 1000;

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

  // 双层上限：用户 max 与解释器兜底 absoluteMax 取小
  const effectiveMax = Math.min(opts.maxLoopIterations, opts.absoluteMaxIterations ?? DEFAULT_ABSOLUTE_MAX);

  const tasks: Task<WorkflowNode>[] = wf.nodes.map((n) => ({
    id: n.id,
    deps: n.deps ?? [],
    payload: n,
  }));
  const plan = buildPlan(tasks);
  const results = new Map<string, unknown>();
  const skipped = new Set<string>(); // 条件跳过节点（级联传播）

  for (const step of plan) {
    for (const { task } of step) {
      const node = task.payload;

      // 级联跳过：依赖的节点被跳过 → 本节点也跳过
      if ((node.deps ?? []).some((d) => skipped.has(d))) {
        skipped.add(node.id);
        continue;
      }

      if (node.loop) {
        // 前置 while：when 满足才执行（不满足 0 次）；无 when 视为 while(true)
        let iter = 0;
        while (iter < effectiveMax && (!node.when || evalCondition(node.when, results))) {
          results.set(node.id, await opts.registry.execute(node.op, node.args ?? {}, ctx));
          iter++;
        }
      } else {
        // 条件：when 满足才执行，否则跳过（并记入 skipped）
        if (node.when && !evalCondition(node.when, results)) {
          skipped.add(node.id);
          continue;
        }
        results.set(node.id, await opts.registry.execute(node.op, node.args ?? {}, ctx));
      }
    }
  }
  return results;
}
