# Minex 阶段报告 41（2026-08-13）—— S5g 修复（去 flaky 时序 + 语义定案）

> 报告制度（固定四节）。本轮内容：按 `docs/task-s5g-fix.md`（review-phase40 收口）完成 6 项修复——去 flaky 时序断言、evalCondition 数值语义、when.field 校验、loop 前置 while、条件跳过级联、maxLoopIterations 双层上限、requestPoolWrite 改发信封。
> 前置：`docs/report-40.md` → `docs/task-s5g-fix.md`。

---

## 一、上次问题回归（task-s5g-fix 六项）

| # | 内容 | 处理 |
|---|---|---|
| 1 | BLOCKER：去 flaky 时序断言 | ✅ 3 处 `toBeLessThan/toBeGreaterThan` wall-clock 断言改并发计数断言（maxActive） |
| 2 | evalCondition 数值比较 + when.field 校验 | ✅ `gt/gte/lt/lte` 用 `Number()`；validateWorkflow 校验 when.field 存在 |
| 3 | loop 前置 while | ✅ loop = `while(when) 执行`（when 不满足 0 次）；无 when = while(true) |
| 4 | 条件跳过级联 | ✅ skipped 集合，依赖被跳过节点也跳过 |
| 5 | maxLoopIterations 双层上限 | ✅ `effectiveMax = min(userMax, absoluteMax)`，absoluteMax 默认 1000 |
| 6 | requestPoolWrite 发信封 | ✅ 改发 `pool-request` 信封，移除直接 pool.write；sendEnvelope 校验 from/to/type 必填 |

---

## 二、本轮目标与内容

见上表六项，均按 task-s5g-fix 落地。

---

## 三、具体实现

### 关键代码定位（file:line，供审查对照）

| 改动点 | 定位 |
|---|---|
| 去 flaky（并发计数断言） | `agent-driver/test/scheduler.test.ts:59-66 / 85-93 / 112-128` |
| evalCondition Number() 数值 | `agent-driver/src/workflow.ts:76-83` |
| when.field 校验 | `agent-driver/src/workflow.ts:44-46` |
| loop 前置 while + 级联跳过 + 双层上限 | `agent-driver/src/interpreter.ts:12-18 / 34-58` |
| requestPoolWrite 发信封 | `agent-driver/src/operations.ts:44-72` |

### 关键设计

1. **并发计数替代 wall-clock**：`maxActive` 计数断言（无依赖 ≥2、限流 =1、混合 ≥2），不依赖真实耗时，杜绝 flaky。
2. **loop 前置 while**：`while(!when || evalCondition(when))`，when 不满足 0 次；无 when 视为 while(true)。
3. **级联跳过**：条件跳过的节点记入 `skipped`，依赖它的节点也跳过（不执行、不进 results）。
4. **双层上限**：`min(userMax, absoluteMax)`，解释器兜底 1000 防 manager 传超大值。
5. **白名单收紧**：移除「直接写池」操作，写池改发 `pool-request` 信封（manager 编排层特权）。

---

## 四、审查标准

### 必须通过（已亲自验证，外部复核）

1. 三连全绿：`typecheck exit 0`（9 包）／`build exit 0`／`test 237/237`（27 文件）。
2. **无 flaky**：scheduler.test.ts 无任何 wall-clock 断言（并发计数替代）。
3. 数值比较 `"10" gt "9"` → true；when.field 引用不存在 → 抛错。
4. loop + when 前置 0 次；双层上限 min(1e9,3)=3 停止；条件跳过级联。
5. requestPoolWrite 发 pool-request 信封（不直接写池）；sendEnvelope 缺 from/to/type 抛错。

### 重点审查

- **P0 安全不回退**：`eval` 未注册仍被拒（validateWorkflow）。
- **P0 循环上限**：双层上限兜底，不写死。
- **P1 级联跳过**：skipped 传播正确，不误跳过无关节点。

### 已知限制（勿误报）

- `absoluteMaxIterations` 默认 1000（可配置），非硬编码死值。
- requestPoolWrite 的 `to` 默认 "manager"，实际 manager id 由编排层注入。

---

**提交状态**：本轮改动独立提交：`fix(agent): S5g 修复（去 flaky 时序 + 语义定案）`。
