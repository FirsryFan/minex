# 任务清单 · S5 收尾（S5g 接线 + S5f 接入 loop）

> 目的：把「代码存在但未接线」的两处补上，让 S5 真正全部落地。验证三连：`npm run typecheck && npm run build && npm test`。

## 1. S5g 接线（改 `packages/agent-driver/src/index.ts`）
- `activate` 里调 `createBuiltinRegistry(ctx)` 得到操作注册表（桥接 tool/envelope/pool/session 能力）。
- 注册 `workflow` 能力：`run(wf, opts?: { maxLoopIterations?: number })` → `validateWorkflow(wf, registry, { maxLoopIterations })` + `executeWorkflow(wf, ctx, { registry, maxLoopIterations })`。
- `run` 返回 `Promise<Map<string, unknown>>`（节点 id → 结果）。

## 2. S5f 接入 loop（改 `packages/agent-driver/src/agent.ts:156-180`）
把「逐个执行工具（串行）」换成 `scheduler.execute` 并行：
- 把 `toolCalls` 转成 `Task[]`（每个 call 一个 Task，`deps: []`，`payload: call`）——LLM 一次产出的 tool_calls 之间无数据依赖，并行执行是核心提效。
- `yield { kind: "toolCall" }` 事件**按原 toolCalls 声明顺序**（执行前逐个 yield，UI 顺序稳定）。
- `execute(tasks, run, { maxConcurrent })` 并行执行；`run` = 解析 args → 查工具 → 执行（含「未找到工具」「执行抛错」的兜底，逻辑同原串行）。
- **结果按原 toolCalls 顺序回灌**（`results.get(String(index))` → `rework(buildToolResultMessage(call.id, result))`），保证缓存友好。
- `maxConcurrent` 作为 `runAgent` 参数（默认 4，可配置）。

## 3. 测试
- **agent loop 并行**（`agent.test.ts`，mock provider 产 2 个无依赖 tool_calls + mock 工具带延时）：断言总耗时≈最慢工具（并行）而非求和；结果回灌顺序 = toolCalls 声明顺序。
- **workflow 接线**（`interpreter.test.ts` 或新 `index` 测试）：经 `workflow.run` 执行一份含 echo 工具的 workflow，结果 Map 键全、`eval` 被拒（安全命题不回退）。

## 验收
- 三连全绿（含连续 2 次全量 test 无 flaky）。
- agent 能力：一次产出多个无依赖工具时并行执行、结果按声明顺序回灌。
- workflow 能力：模型数据可经 `workflow.run` 实际执行（不再「代码存在但不可用」）。
