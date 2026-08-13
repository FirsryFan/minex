# 任务清单 · S5g 修复（review-phase40 收口）

> 依据 review-phase40 + designer 定案（见报告「理念说明」节）。验证三连：`npm run typecheck && npm run build && npm test`。

## 1. BLOCKER：去 flaky 时序断言（scheduler.test.ts:125）
- 删除 `expect(elapsed).toBeLessThan(48)`（wall-clock 断言）。
- 改用**执行顺序断言**：`order` 数组断言 B 在 A 之后、C 与 A 并行（C 先于 B 完成）；或用「并发重叠计数」断言 A 与 C 的 run 有交集。
- 不得用任何 `toBeLessThan(ms)` 断言真实耗时。

## 2. evalCondition 数值比较 + when.field 校验（workflow.ts）
- `gt/gte/lt/lte` 前对 `actual`/`value` 显式 `Number()` 转换；`eq/ne` 保持原值。
- `validateWorkflow` 校验 `when.field` 引用的节点存在于 workflow 中，否则抛错（杜绝 `eq undefined` 误判真）。
- 补测试：`"10" gt "9"` → true（数值语义）；`when.field` 引用不存在的节点 → 抛错。

## 3. loop 语义定为前置 while + 补测试（interpreter.ts）
- loop = `while(when) 执行`（when 不满足 0 次）；无 when 视为 `while(true)`。
- 补测试：`loop + when`（依赖 counter 节点、when 不满足即 0 次）、`loop + when` 正常循环 N 次后停。

## 4. 条件跳过级联（interpreter.ts）
- 维护「已跳过节点集合」；执行节点前检查 deps 是否含被跳过节点，含则也跳过（级联）。
- 补测试：A 被 when 跳过 → 依赖 A 的 B 也跳过（不在 results 里，不执行）。

## 5. maxLoopIterations 双层上限（interpreter.ts）
- `effectiveMax = Math.min(userMax, absoluteMax)`，`absoluteMax` 为解释器层兜底（默认 1000，可配置）。
- 补测试：传入 1e9 → 循环在 absoluteMax 处停止。

## 6. requestPoolWrite 改为「发 pool-request 信封」（operations.ts）
- `requestPoolWrite` 实现改为构造 `pool-request` 信封（payload 带 key/value）并 `sendEnvelope` 发给 manager；**移除直接 `pool.write`**。
- 白名单不含「直接写池」操作（写池是 manager 编排层特权）。
- sendEnvelope 桥接校验 `from/to/type` 必填，缺失抛错（INFO-3）。

## 验收
- 三连全绿（无 flaky）。
- `scheduler.test.ts` 连续 3 次全量跑全绿。
- workflow 引用 `eval` 仍被拒（安全命题不回退）。
