# 任务清单 · S5f（调度器 execute：依赖拓扑排序 + 并行）

> 依据 `s5-agent-design.md`（第七章调度器）。核心命题：执行顺序由「数据依赖」决定，非声明顺序；无依赖并行、有依赖串行。
> 前置：无需等 S5d/S5e——execute 是纯算法（接收 run 回调，不关心任务是什么），可独立实现 + mock 测试。
> 验证三连：`npm run typecheck && npm run build && npm test`。

## 1. 类型（src/scheduler.ts）
- `Task<T = unknown> = { id: string; deps: string[]; priority?: number; estimatedTime?: number; weight?: number; payload: T }`
- `ScheduleStep<T> = { task: Task<T> }[]`（一层可并行执行的任务组，按序执行各层）
- `Heuristic<T> = (a: Task<T>, b: Task<T>) => number`（同层排序比较器）

## 2. 纯函数（src/scheduler.ts）
- `buildPlan<T>(tasks: Task<T>[], heuristic?: Heuristic<T>): ScheduleStep<T>[]`
  - 按 deps 分层：无依赖任务进第一层，逐层剥离。
  - **环检测**：存在环（依赖无法满足）抛错，附环上任务 id。
  - 同层按 heuristic 排序；默认 `priority 降序 → estimatedTime 降序`（关键路径优先的简化贪心）。
- `verifyPlan<T>(tasks, plan): boolean`（可选，校验 plan 覆盖全部任务且依赖序正确）。

## 3. 执行编排（src/scheduler.ts）
- `execute<T, R>(tasks: Task<T>[], run: (task: Task<T>) => Promise<R>, opts?: { maxConcurrent?: number; heuristic?: Heuristic<T> }): Promise<Map<string, R>>`
  - 按 `buildPlan` 逐层执行：层内并行（`maxConcurrent` 限制同层并发数，默认 Infinity），层间串行。
  - **结果按任务 id 返回 Map**（调用方按原声明顺序取结果，保证缓存友好）。
  - 单任务失败：捕获并继续（或记录错误结果），不中断整层——由 opts 决定，默认「失败记录、继续」。

## 4. 测试（test/scheduler.test.ts）
- `buildPlan`：无依赖（单层）/ 链式 A←B←C（三层）/ 树 / **环检测抛错**。
- 同层排序：priority 降序、estimatedTime 降序、自定义 heuristic。
- `execute`（mock run 带延时）：无依赖并行（总耗时≈最慢者非求和）/ 有依赖串行 / 结果 Map 键全 / maxConcurrent 限流 / 单任务失败不中断。

## 验收
- 三连全绿。
- mock 场景验证：`[A, B, C]`（A 慢、B 依赖 A、C 独立慢）→ execute 后 B 在 A 之后、C 与 A 并行，总耗时≈max(A,C)+B，非 A+B+C。
