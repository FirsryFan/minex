# Minex 阶段报告 39（2026-08-13）—— 阶段 38 审查修复（失败 Error 标记 / 依赖缺失区分 / 混合时序断言）

> 报告制度（固定四节）。本轮内容：执行 `review-phase38-report.md`——2 处 MINOR（失败 vs undefined 不可区分、dangling 依赖误报环）+ INFO-4（混合时序断言）。
> 前置：`docs/report-38.md` → `docs/review-phase38-report.md`。

---

## 一、上次问题回归

- review-phase38 无 BLOCKER/MAJOR，2 处 MINOR + 4 处 INFO。
- **MINOR-1 已修** ✅：失败存 `Error` 对象（可 `instanceof Error` 精确判定，区别于「成功返回 undefined」）。
- **MINOR-2 已修** ✅：buildPlan 开头先检测 deps 指向不存在的任务，报「依赖缺失：a→b」；真环仍报「循环依赖」。
- **INFO-4 已补** ✅：混合场景精确时序断言（B 在 A 后、C 与 A 并行、耗时≈max(A,C)+B）。
- 回归面：三连保持全绿（本轮实测 25 文件 / 219 测试）。

---

## 二、本轮目标与内容

| # | 内容 | 定位 |
|---|---|---|
| 1 | MINOR-1 失败存 Error | `scheduler.ts` execute catch 存 Error 对象 |
| 2 | MINOR-2 依赖缺失区分 | `scheduler.ts` buildPlan 开头检测缺失依赖 |
| 3 | INFO-4 混合时序断言 | `scheduler.test.ts` 补精确断言 |

---

## 三、具体实现

### 关键代码定位（file:line，供审查对照）

| 改动点 | 定位 |
|---|---|
| 依赖缺失检测 | `agent-driver/src/scheduler.ts:38-43` |
| 失败存 Error | `agent-driver/src/scheduler.ts:119-123` |
| 混合时序/失败区分测试 | `agent-driver/test/scheduler.test.ts` |

### 关键设计

1. **失败存 Error**：`results.set(id, err instanceof Error ? err : new Error(String(err)))`，调用方 `instanceof Error` 精确判定失败，与「成功返回 undefined」区分。
2. **依赖缺失 vs 环分开报错**：先查 deps 指向不存在任务 →「依赖缺失：a→b」；Kahn 无法入队的剩余任务 →「循环依赖」。排障信息准确。

---

## 四、审查标准

### 必须通过（已亲自验证，外部复核）

1. 三连全绿：`typecheck exit 0`（9 包）／`build exit 0`／`test 219/219`（25 文件）。
2. 失败存 Error（`instanceof Error` 可判定）；成功返回 undefined 与失败可区分。
3. 依赖缺失报「依赖缺失」，环报「循环依赖」，两者不混淆。
4. 混合场景：B 在 A 后、C 与 A 并行、耗时≈max(A,C)+B（非求和）。

### 已知限制 / INFO（勿误报，沿用 review-phase38）

- INFO-2（重复 id 未校验）—— 调用方责任，建议校验 id 唯一或文档约束。
- INFO-3（结果 Map 迭代顺序=完成顺序）—— 调用方应按 tasks 声明顺序 `get(id)` 取结果。
- report-38 测试计数误差（scheduler 实为 13 用例，非 14）—— 文档计数，非代码缺陷。

---

**提交状态**：本轮改动独立提交：`fix(agent): 阶段38审查修复（失败 Error 标记 / 依赖缺失区分 / 混合时序断言）`。
