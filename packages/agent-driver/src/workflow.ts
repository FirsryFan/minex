/**
 * 工作流 DSL（S5g）：模型生成的声明式数据（非可执行代码），固定解释器执行。
 * 能力面 = 白名单操作注册表——「代码强度不能被实施」。
 */

/** 有限比较算子（无 eval/任意表达式） */
export type ConditionOp = "eq" | "ne" | "gt" | "gte" | "lt" | "lte";

export interface Condition {
  field: string;
  op: ConditionOp;
  value: unknown;
}

export interface WorkflowNode {
  id: string;
  op: string;
  args?: Record<string, unknown>;
  deps?: string[];
  when?: Condition;
  loop?: boolean;
}

export interface Workflow {
  nodes: WorkflowNode[];
}

/** 操作注册表最小接口（validateWorkflow 只查 has） */
export interface OperationRegistryLike {
  has(name: string): boolean;
}

/**
 * 校验工作流：节点 id 唯一、deps 引用存在、op 在注册表、loop 节点必须有全局上限。
 * 违规抛错。纯函数可测。
 */
export function validateWorkflow(
  wf: Workflow,
  registry: OperationRegistryLike,
  opts: { maxLoopIterations?: number } = {},
): void {
  const ids = new Set<string>();
  for (const n of wf.nodes) {
    if (ids.has(n.id)) throw new Error(`节点 id 重复：${n.id}`);
    ids.add(n.id);
  }
  for (const n of wf.nodes) {
    for (const d of n.deps ?? []) {
      if (!ids.has(d)) throw new Error(`节点依赖不存在：${n.id} → ${d}`);
    }
    if (!registry.has(n.op)) throw new Error(`未注册操作：${n.op}`);
    if (n.when && !ids.has(n.when.field)) {
      throw new Error(`when.field 引用不存在的节点：${n.when.field}`);
    }
    if (n.loop && !(opts.maxLoopIterations !== undefined && opts.maxLoopIterations > 0)) {
      throw new Error(`loop 节点需要 maxLoopIterations 上限：${n.id}`);
    }
  }
}

/**
 * 求值条件：field 引用之前节点 id 的结果（从 results 取），按有限算子比较。
 * 纯函数可测。
 */
export function evalCondition(cond: Condition, results: Map<string, unknown>): boolean {
  const actual = results.get(cond.field);
  switch (cond.op) {
    case "eq":
      return actual === cond.value;
    case "ne":
      return actual !== cond.value;
    case "gt":
      return Number(actual) > Number(cond.value); // 数值语义（"10" > "9"）
    case "gte":
      return Number(actual) >= Number(cond.value);
    case "lt":
      return Number(actual) < Number(cond.value);
    case "lte":
      return Number(actual) <= Number(cond.value);
  }
}
