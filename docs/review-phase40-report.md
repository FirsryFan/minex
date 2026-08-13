# Minex 阶段 40 审查报告（S5g：代码插槽）

> 审查日期：2026-08-13　|　范围：`packages/agent-driver`（workflow.ts / operations.ts / interpreter.ts）
> 对照：`docs/task-s5g.md` + `docs/s5-agent-design.md` 第七节 + `docs/report-40.md`

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

**`npm test`** — ⚠️ **第一次全量跑失败，第二次通过（flaky）**

```
第一次：Test Files 26 passed | 1 failed (27)
        Tests 231 passed | 1 failed (232)
        FAIL packages/agent-driver/test/scheduler.test.ts > execute > 混合场景…耗时≈max(A,C)+B
第二次：Test Files 27 passed | 27
        Tests 232 passed (232)   exit 0
单独跑 scheduler.test.ts：16 passed
```

**三连中 test 存在 flaky**，与 report-40 声明的「test 232/232 全绿」不符（本人第一次全量跑即复现 231/232 失败）。

---

## 一、BLOCKER（必须修）

### BLOCKER-1　`scheduler.test.ts`「混合场景」时序断言 flaky，三连不稳定

- **位置**：`packages/agent-driver/test/scheduler.test.ts:125`
- **根因**：`expect(elapsed).toBeLessThan(48)` 用 wall-clock 断言「并行耗时 ≈ max(20,20)+10 = 30ms，非串行 50ms」。但 `sleep(20)/sleep(10)/sleep(20)` 的真实耗时受 setTimeout 调度抖动/机器负载影响，阈值 48ms 只留 18ms 余量，全量测试（27 文件并发、CPU 争抢）下极易超时。
- **实测证据**：
  ```
  第一次 npm test（全量）：Tests 231 passed | 1 failed —— 正是「混合场景」测试
  第二次 npm test（全量）：Tests 232 passed（通过）
  单独 vitest run scheduler.test.ts：16 passed（通过）
  => 结果随负载抖动，典型 flaky 时序测试
  ```
- **归属**：这是 report-39「修复 INFO-4（补混合时序断言）」引入的**新问题**——修复本身用了紧阈值的 wall-clock 断言，把「逻辑正确」绑到「机器速度」上。违反 report-40「232/232 全绿」声明（历史教训 A1：声称全绿、实际偶发失败）。
- **后果**：CI/全量环境下三连偶发红，破坏「typecheck/build/test 三连全绿」的提交门槛可信度；后续任何阶段都可能被这个无关测试挡下。
- **修复方向**：**去掉 wall-clock 耗时断言**，保留「执行顺序」断言（`order` 数组已能证明 B 在 A 后、C 与 A 并行）；或用 `vi.useFakeTimers()` 控制时间；或用「并发重叠计数」断言 A 与 C 的 `run` 有交集（更直接证明并行）。**不要用 `toBeLessThan(ms)` 断言真实耗时。**

---

## 二、MAJOR（建议修）

**无。**

核心安全命题已核实成立：`executeWorkflow` 只查表调用 `registry.execute(op)`，`validateWorkflow` 拒绝未注册 op（`eval`/`new Function`/`import` 均不在白名单，测试 `interpreter.test.ts:78-81` 已验证 `eval` 被拒）；`createRegistry` 无任意代码路径。**「代码强度不能被实施」成立**。

---

## 三、MINOR / INFO（可留 / 观察）

### MINOR

1. **`evalCondition` 数值算子用 `as number` 强转（非转换），字符串数字比较结果错误**（`workflow.ts:70-76`）
   - **实测证据**：
     ```
     "10" gt 9        => true   (JS 混合比较转数字，正常)
     "10" gt "9"      => false  (两字符串按字典序，"10"<"9"，数值语义错误)
     10 gt 9          => true   (正确)
     ```
   - **后果**：模型生成的 workflow 若 `when.value` 为字符串数字（如 `"9"`），数值比较退化为字典序，`"10" > "9"` 得到 false。`as number` 是类型断言、不做运行时转换。
   - **修复方向**：`gt/gte/lt/lte` 前 `Number(actual)`/`Number(value)` 显式转数值；或校验 `field`/`value` 类型为 number 否则拒绝。

2. **loop 节点的 `when` 语义未明确（前置 while vs 后置 do-while），且「有 when 的 loop」无测试覆盖**
   - `interpreter.ts:38-42` 是**前置条件**（`while` 先判断 `when`，满足才执行，可能 0 次）；task-s5g「重复执行直到 when 不满足」暗示**后置条件**（do-while 至少 1 次）。现有测试「循环达上限停止」用的 `loop: true` 无 `when`，未覆盖「有 when 的循环」。
   - **修复方向**：明确 loop 语义并补「有 when 的 loop」测试（如 `loop` 依赖 `counter` 节点、`when: counter < 3`）。

3. **`when.field` 未校验引用依赖节点，可引用不存在/未来节点**（`workflow.ts:63`）
   - **实测证据**：`evalCondition({field:"ghost", op:"eq", value:undefined}, Map())` => `true`（field 不存在时 `eq undefined` 误判真）。
   - **后果**：条件引用不存在的节点（或拼写错误）时静默按 undefined 比较，不报错，workflow 语义错乱难排障。

### INFO

1. **`requestPoolWrite` 桥接为直接写，绕过「manager 独占写」**（`operations.ts:64-68`）：`requestPoolWrite` 操作名是「请求写」，实现是 `pool.write` 直接写。report-40 已知限制第 1 条已声明「编排层保证」，**接受**；但需 designer 明确：当前任何 workflow 节点都能越权写消息池（绕过 S5e「申请→批准」），「编排层保证」是未来承诺，接线时应改回「发 pool-request 信封」的正确语义。
2. **`maxLoopIterations` 无绝对上限兜底**（`interpreter.ts:38`）：上限由用户/manager 传入（D6 设计决策），但传入超大值（如 1e9）时循环等效无界，无解释器层绝对上限保护。
3. **`sendEnvelope` 桥接透传 `args` 未校验信封必填字段**（`operations.ts:54-57`）：`envelope.send(args)` 直接透传节点参数，缺 `from/to/type` 时 emit 出「伪信封」。
4. **条件跳过节点后依赖节点仍执行（级联语义未定义）**：`when` 不满足的节点 `continue`，结果不存在于 `results`，但 `buildPlan` 只按 deps 拓扑放行其依赖者，依赖者读到 undefined 结果。是否「跳过应级联到依赖者」未定义、未测试。
5. **report-40 测试计数误差**：文中「workflow 8 用例 + interpreter 6 用例」，实际 workflow 为 **7**（validateWorkflow 5 + evalCondition 2）、interpreter 6，合计 13（总 232 正确）。
6. **`createBuiltinRegistry` 未接线**（report 已声明）：桥接函数就绪，未在 index.ts 注册，编排层整合时接线。

---

## 四、上一轮问题回归（review-phase38 → report-39 修复）

| review-phase38 问题 | 判定 | 验证 |
|---|---|---|
| MINOR-1 失败 vs undefined 不可区分 | ✅ 已修 | `scheduler.ts:126` 失败存 `Error`（`instanceof Error` 判定）；测试 `scheduler.test.ts:104-111` 断言「成功 undefined」与「失败 Error」可区分 |
| MINOR-2 dangling 依赖误报环 | ✅ 已修 | `scheduler.ts:38-43` 开头检测 deps 指向不存在任务，报「依赖缺失」；真环仍报「循环依赖」 |
| INFO-4 混合时序断言 | ◐ 已补但引入 flaky | 补了 `scheduler.test.ts:112-126` 混合场景，但用 `toBeLessThan(48)` 紧阈值 wall-clock 断言 → **引入 BLOCKER-1 flaky** |

**结论**：report-39 的 MINOR-1/2 修复真实有效；但 INFO-4 的「修复」用 wall-clock 耗时断言，引入了 flaky 测试，成为本轮 BLOCKER。

---

## 五、验收逐条判定（对照 task-s5g.md）

| 条目 | 判定 | 说明 |
|---|---|---|
| 三连全绿 | ❌ | typecheck/build 绿，但 **test flaky**（第一次全量 231/232），违反「全绿」 |
| 1. DSL 类型 + validateWorkflow | ✅ | id 唯一 / deps 存在 / op 白名单 / loop 上限均校验 |
| 2. 操作注册表（白名单） | ✅ | `createRegistry` 查表调用，`createBuiltinRegistry` 桥接 7 操作 |
| 3. 解释器（复用 buildPlan + 控制流） | ◐ | 顺序/条件/循环正确，但 loop `when` 语义未明确（MINOR-2） |
| 4. 安全边界（eval/import/网络/文件禁止） | ✅ | 无任意代码路径，`eval` 被 validateWorkflow 拒绝 |
| 5. 测试 | ◐ | workflow 7 + interpreter 6（report 计数多 1，INFO-5）；有 when 的 loop 未测（MINOR-2） |
| 验收：echo + 条件 + 循环达上限 + eval 拒 | ✅ | 测试覆盖（循环为无条件循环） |

---

## 六、结论与修复优先级

本轮 S5g 的**核心安全命题成立**（白名单 + 固定解释器，无任意代码路径），但存在 **1 处 BLOCKER（flaky 测试）**，直接违背 report-40「232/232 全绿」声明。另 3 MINOR + 6 INFO。

**修复优先级：**

1. **BLOCKER-1（flaky 测试）** —— 最高优先，必须修：去掉 `scheduler.test.ts:125` 的 `toBeLessThan(48)` wall-clock 断言，改用执行顺序断言或 fake timers。否则后续每轮三连都可能被这个无关测试偶发挡下，破坏「全绿」门槛的可信度。
2. **MINOR-1（evalCondition 字符串数字比较）** —— 显式 `Number()` 转换或校验类型，避免字符串数字比较语义错乱。
3. **MINOR-2/3（loop 语义 + when.field 校验）** —— 明确 loop 前置/后置语义并补测试；`when.field` 校验引用节点存在，杜绝 `eq undefined` 误判。
4. INFO-1/2/3/4（requestPoolWrite 越权、maxLoopIterations 绝对上限、sendEnvelope 校验、条件跳过级联）—— 属编排层接线时的语义收口，建议接线前一次性明确。
