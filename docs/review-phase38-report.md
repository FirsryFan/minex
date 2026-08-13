# Minex 阶段 38 审查报告（S5f：调度器）

> 审查日期：2026-08-13　|　范围：`packages/agent-driver/src/scheduler.ts`
> 对照：`docs/task-s5f.md` + `docs/s5-agent-design.md` 第六节 + `docs/report-38.md`

## 审查基线

三连本人实测（Windows Git Bash，cwd `E:/Minex`）：

**`npm run typecheck`** — exit 0（9 包）

```
> tsc --noEmit   (×9)
===TYPECHECK_EXIT:0===
```

**`npm run build`** — exit 0

```
> tsc (×8) + tsc --noEmit && vite build（ui-shell）
===BUILD_EXIT:0===
```

**`npm test`** — exit 0（25 文件 / 216 测试全绿）

```
✓ packages/agent-driver/test/scheduler.test.ts (13 tests)
 Test Files  25 passed (25)
      Tests  216 passed (216)
===TEST_EXIT:0===
```

三连结果与 report-38 声明一致（总量 216 正确）。

---

## 一、BLOCKER（必须修）

**无。**

Kahn 拓扑分层、层内并行、层间串行、环检测、失败继续的核心逻辑正确。实测环检测准确（`a↔b` 报 `存在循环依赖：a, b`，无环的 `c` 不在列表）。

---

## 二、MAJOR（建议修）

**无。**

---

## 三、MINOR / INFO（可留 / 观察）

### MINOR

1. **失败任务与「成功返回 undefined」不可区分**（`scheduler.ts:118`）
   - **根因**：失败路径 `results.set(task.id, undefined as unknown as R)`，与 `run` 成功返回 `undefined` 的 `results.set(task.id, undefined)` 落点完全相同。
   - **实测证据**：
     ```
     has("fail")=true  get("fail")=undefined
     has("undef")=true get("undef")=undefined   // undef 成功但返回 undefined
     => 两者 has/get 完全一致，调用方无法区分失败与「成功返回 undefined」
     ```
   - **归属**：report-38 已知限制第 1 条称「调用方需自判」，但**实际在 `R` 含 `undefined` 时无法自判**（`has` 恒 true、`get` 恒 undefined）。该「自判」表述不准确。
   - **修复方向**：失败记录独立错误对象（如 `results` 之外维护 `failed: Set<string>`，或结果项用 `{ ok: false, error }` 联合），使失败可精确判定；或在类型/文档上约束「`run` 不得返回 undefined」。

2. **dangling 依赖（依赖不存在的任务）误报为「循环依赖」**（`scheduler.ts:70-73`）
   - **根因**：环检测用 `processed < tasks.length` 判定「有任务依赖永远无法满足」，把「依赖指向不存在的任务」与「真环」归为同一类，错误信息统一报「存在循环依赖」。
   - **实测证据**：
     ```
     buildPlan([{ id:"a", deps:["nonexistent"], payload:undefined }])
     => 抛 "存在循环依赖：a"   // 实际是「依赖缺失」，非环
     ```
   - **后果**：错误信息误导排障（把「依赖拼错/任务缺失」误指为「环」）。任务清单允许「依赖无法满足即抛错」，但错误类型未区分。
   - **修复方向**：区分「依赖 id 不存在于 tasks」与「真环」，分别报「依赖缺失：a→nonexistent」与「循环依赖：…」。

### INFO

1. **report-38 测试计数误差**：文中「scheduler 14 用例」，实际 **13**（buildPlan 6 + verifyPlan 2 + execute 5）；总 216 正确。
2. **重复 id 未校验**（`scheduler.ts:37`）：`byId` 用 `new Map(tasks.map(t => [t.id, t]))` 后到者覆盖前者，但 `tasks.filter(...)` 仍产出两个同 id。实测 `buildPlan` 两个同 id 任务首层任务数 = 2（均映射到同一 task 对象），`execute` 会重复执行 + 结果覆盖。属调用方责任，建议校验 id 唯一或文档约束。
3. **结果 Map 迭代顺序 = 完成顺序（非声明顺序）**：`results.set` 在 `Promise.all` 内任务完成时调用。实测三并行任务（fast/slow/mid）结果 Map 迭代顺序为 `fast,mid,slow`（完成顺序），非声明顺序 `fast,slow,mid`。任务清单「调用方按原声明顺序取结果」是约定，但需调用方**按 tasks 声明顺序 `get(id)`**，而非直接迭代 Map——否则「缓存友好」的回填顺序被破坏。
4. **验收「混合场景」执行时序/耗时无精确断言**：`scheduler.test.ts` 有「结果 Map 键全」用例（`a` 无依赖、`b` 依赖 `a`、`c` 无依赖，实为混合），但仅断言结果，未断言「B 在 A 之后、C 与 A 并行、总耗时≈max(A,C)+B 非 A+B+C」。task-s5f.md 验收的精确时序/耗时断言缺失。

---

## 四、上一轮问题回归（review-phase36 → report-37 修复）

| review-phase36 问题 | 判定 | 验证 |
|---|---|---|
| MINOR-1 onEnvelope `*` 重复订阅 | ✅ 已修 | `envelope.ts:69` 改为 `[...new Set([...])]` 去 topic；实测 `onEnvelope(bus,"*",cb)` 广播次数 = **1**（修复前 = 2） |

上一轮问题**真实修复**，report-37/38 的「无回归」声明属实。

---

## 五、验收逐条判定（对照 task-s5f.md）

| 条目 | 判定 | 说明 |
|---|---|---|
| 三连全绿 | ✅ | typecheck(9 包) / build / test(216) 实测 exit 0 |
| 1. 类型（Task/ScheduleStep/Heuristic） | ✅ | 定义齐全，weight 预留 |
| 2. buildPlan（分层 + 环检测 + 启发式） | ✅ | 无依赖/链式/树/环/排序/自定义 heuristic 均测 |
| 2. verifyPlan | ✅ | 覆盖 + 依赖序 + 缺失任务返回 false |
| 3. execute（并行 + 限流 + 结果 Map + 失败继续） | ◐ | 主链路正确；失败用 undefined 标记与「成功返回 undefined」不可区分（MINOR-1） |
| 4. 测试 | ◐ | 13 用例（report 计数多 1，INFO-1）；验收混合场景时序/耗时未断言（INFO-4） |
| 验收：B 在 A 后、C 与 A 并行、耗时≈max(A,C)+B | ◐ | 逻辑满足（分层 + 层内并行保证），但无精确断言测试（INFO-4） |

---

## 六、结论与修复优先级

本轮 S5f **无 BLOCKER、无 MAJOR**，调度器核心算法（Kahn 拓扑 + 并行 + 环检测 + 失败继续）正确、三连全绿、上一轮问题已真实修复。2 处 MINOR + 4 处 INFO，均为边界/观测，不影响主链路正确性。

**修复优先级：**

1. **MINOR-1（失败 vs undefined 不可区分）** —— 最值得修：report 的「调用方自判」表述与实际不符，建议失败用独立错误对象或失败集合标记，否则后续编排层接入时可能「把失败当成功（undefined）」。
2. **MINOR-2（dangling 依赖误报为环）** —— 排障体验，区分「依赖缺失」与「环」两类错误。
3. INFO-4（验收混合场景时序/耗时断言）—— 补一个 `[A 慢, B 依赖 A, C 独立慢]` 的精确断言测试，锁住「耗时≈max(A,C)+B 非求和」这个调度器核心命题。
4. INFO-2/3（重复 id 校验、结果 Map 迭代顺序约定）—— 文档约束 + 调用方纪律，随 S5f 编排层整合时落地。
