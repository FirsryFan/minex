/**
 * 调度器（S5f）：执行顺序由「数据依赖」决定，非声明顺序；无依赖并行、有依赖串行。
 * 纯算法（接收 run 回调，不关心任务语义）。
 */

export interface Task<T = unknown> {
  id: string;
  deps: string[];
  priority?: number;
  estimatedTime?: number;
  weight?: number;
  payload: T;
}

/** 一层可并行执行的任务组 */
export type ScheduleStep<T> = { task: Task<T> }[];

/** 同层排序比较器（返回负数则 a 在前） */
export type Heuristic<T> = (a: Task<T>, b: Task<T>) => number;

/** 默认贪心：priority 降序 → estimatedTime 降序（关键路径优先的简化） */
function defaultHeuristic<T>(a: Task<T>, b: Task<T>): number {
  const pa = a.priority ?? 0;
  const pb = b.priority ?? 0;
  if (pa !== pb) return pb - pa;
  const ea = a.estimatedTime ?? 0;
  const eb = b.estimatedTime ?? 0;
  return eb - ea;
}

/**
 * 按依赖拓扑分层：无依赖任务进第一层，逐层剥离；同层按 heuristic 排序。
 * 存在环（依赖无法满足）时抛错，附环上任务 id。
 * 纯函数可测。
 */
export function buildPlan<T>(tasks: Task<T>[], heuristic?: Heuristic<T>): ScheduleStep<T>[] {
  // 依赖缺失检测（区别于环）：deps 指向不存在的任务（审查 MINOR-2）
  const ids = new Set(tasks.map((t) => t.id));
  for (const t of tasks) {
    for (const d of t.deps) {
      if (!ids.has(d)) throw new Error(`依赖缺失：${t.id} → ${d}`);
    }
  }
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const indegree = new Map<string, number>();
  const dependents = new Map<string, string[]>();
  for (const t of tasks) {
    indegree.set(t.id, t.deps.length);
    for (const d of t.deps) {
      if (!dependents.has(d)) dependents.set(d, []);
      dependents.get(d)!.push(t.id);
    }
  }

  const sort = heuristic ?? defaultHeuristic;
  const plan: ScheduleStep<T>[] = [];
  let current = tasks.filter((t) => t.deps.length === 0).map((t) => t.id);
  let processed = 0;

  while (current.length > 0) {
    const sorted = current.map((id) => byId.get(id)!).sort(sort);
    plan.push(sorted.map((task) => ({ task })));
    processed += current.length;

    const next: string[] = [];
    for (const id of current) {
      for (const depId of dependents.get(id) ?? []) {
        const deg = indegree.get(depId)! - 1;
        indegree.set(depId, deg);
        if (deg === 0) next.push(depId);
      }
    }
    current = next;
  }

  // 环检测：还有任务 indegree > 0（依赖永远无法满足，且依赖均在 tasks 内 → 真环）
  if (processed < tasks.length) {
    const cyclic = tasks.filter((t) => (indegree.get(t.id) ?? 0) > 0).map((t) => t.id);
    throw new Error(`存在循环依赖：${cyclic.join(", ")}`);
  }
  return plan;
}

/** 校验 plan 覆盖全部任务且依赖序正确（可选，调试/测试用）。 */
export function verifyPlan<T>(tasks: Task<T>[], plan: ScheduleStep<T>[]): boolean {
  const seen = new Set<string>();
  for (const step of plan) {
    for (const { task } of step) {
      if (seen.has(task.id)) return false; // 重复
      if (!task.deps.every((d) => seen.has(d))) return false; // 依赖未在前层
      seen.add(task.id);
    }
  }
  return seen.size === tasks.length && tasks.every((t) => seen.has(t.id));
}

export interface ExecuteOptions<T> {
  /** 同层最大并发数，默认 Infinity（整层并行） */
  maxConcurrent?: number;
  heuristic?: Heuristic<T>;
}

/**
 * 按 buildPlan 逐层执行：层内并行（maxConcurrent 限流）、层间串行。
 * 结果按任务 id 返回 Map；单任务失败捕获、记录 undefined、继续（不中断整层）。
 */
export async function execute<T, R>(
  tasks: Task<T>[],
  run: (task: Task<T>) => Promise<R>,
  opts?: ExecuteOptions<T>,
): Promise<Map<string, R>> {
  const plan = buildPlan(tasks, opts?.heuristic);
  const results = new Map<string, R>();
  const maxConcurrent = opts?.maxConcurrent ?? Infinity;

  for (const step of plan) {
    const stepTasks = step.map((s) => s.task);
    for (let i = 0; i < stepTasks.length; i += Math.max(1, maxConcurrent)) {
      const batch = stepTasks.slice(i, i + Math.max(1, maxConcurrent));
      await Promise.all(
        batch.map(async (task) => {
          try {
            results.set(task.id, await run(task));
          } catch (err) {
            // 失败记录 Error 对象（可精确判定，区别于「成功返回 undefined」，审查 MINOR-1）
            results.set(task.id, (err instanceof Error ? err : new Error(String(err))) as unknown as R);
          }
        }),
      );
    }
  }
  return results;
}
