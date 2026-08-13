# Minex 阶段 34 审查报告（S5d：agent 驱动雏形 ReAct loop）

> 审查日期：2026-08-13　|　范围：`packages/agent-driver` + `packages/llm-driver`（S5d 扩展）
> 对照：`docs/task-s5d.md` + `docs/s5-agent-design.md` + `docs/report-34.md`

## 审查基线

三连本人实测（Windows Git Bash，cwd `E:/Minex`）：

**`npm run typecheck`** — exit 0（9 包，新增 agent-driver）

```
> tsc --noEmit   (×9)
===TYPECHECK_EXIT:0===
```

**`npm run build`** — exit 0

```
> tsc   (×8)  +  tsc --noEmit && vite build（ui-shell）
✓ 2072 modules transformed.
✓ built in 20.27s
===BUILD_EXIT:0===
```

**`npm test`** — exit 0（22 文件 / 190 测试全绿，agent-driver 新增 10 用例）

```
✓ packages/agent-driver/test/agent.test.ts (10 tests)
 Test Files  22 passed (22)
      Tests  190 passed (190)
===TEST_EXIT:0===
```

三连结果与 report-34 声明一致。

---

## 一、BLOCKER（必须修）

**无。**

跨包依赖/工具往返的协议正确性已核实：agent 驱动用 `ctx.get/query`（受限视图，`kernel.ts:65-66` 已剥 `.value`），未踩历史教训 B1（`.value` 漏取）；`ctx.query<AgentTool>("tool")` 与 `ctx.get<LLMProvider>("llm","deepseek")` 类型与返回值均正确。工具往返协议正确：assistant 带 `tool_calls` → 逐条 `role:"tool"` 带 `tool_call_id`，顺序与 index 排序一致。

---

## 二、MAJOR（建议修）

### MAJOR-1　工具结果回灌 history（S 层）而非 workMemory（W 层）—— 与 S5b 分层设计冲突，缓存纪律受破坏

- **位置**：`packages/agent-driver/src/agent.ts:151-176`（`history.push` 工具结果）+ `:97`（`buildMessages({ ..., workMemory: [] })`）
- **根因**：S5b 设计文档明确「W 工作记忆层 = 提炼的最新状态 / **tool_result 加工产物** / 动态指令（末尾）」「再加工 hook 挂在**填充 W 层**路径」。但 S5d 任务清单写「工具结果经再加工 hook 后**回灌 history**」，实现按 S5d 走——`rework` 产物 `history.push`（S 层），而 `buildMessages` 的 `workMemory` 参数**恒传空数组**（W 层完全空置）。
- **实测证据**：
  ```
  buildMessages({ systemPrompt, history:[assistant(tool_calls), tool(结果)], workMemory:[] })
  => 角色序列 system→assistant→tool
     tool 结果在第 3 位，紧跟 system（S 层稳定前缀区），W 层无任何内容
  ```
- **后果**：
  1. **缓存纪律**（设计文档 D7「S 层严守缓存」、D2「缓存与注意力解耦」）被破坏——工具结果是每次执行都不同的动态内容，进 S 层后，ReAct 第二轮起 messages 前缀 = `[system, assistant(tool_calls), tool(动态结果), …]`，仅 `system` 前缀稳定命中，工具往返后的前缀逐轮变化，缓存命中率随循环次数崩塌。
  2. **文档矛盾**：S5b「tool_result 进 W 层」与 S5d「回灌 history」直接冲突，未在设计文档中更新或裁决。
- **归属**：S5d 任务清单明确写「回灌 history」，故这是 **S5b↔S5d 分层设计的未定案矛盾**（非逻辑 bug），需 designer 裁决。需注意：ReAct 协议要求 `role:"tool"` 消息**必须紧跟**对应 `assistant(tool_calls)` 消息，故「把工具结果整体移到 messages 末尾 W 层」在协议上不可行——这正是矛盾的核心，designer 需给出 ReAct 下 S/W 层边界的准确定义。
- **修复方向**（供 designer 决策）：
  - A：明确「工具往返历史」属于 S 层（append-only 历史的一部分），W 层只承载**非协议性**的工作记忆摘要（如跨轮提炼/长期记忆），更新 S5b 文档措辞；
  - B：`rework` 产物双写——既回灌 history（协议必需）又提炼进 W 层 `workMemory`（供下一轮 `buildMessages`），真正落地 S/W 分层。

---

## 三、MINOR / INFO（可留 / 观察）

### MINOR

1. **`ttftMs` 在纯 tool_call 流（无文本 delta）恒为 0**（`agent.ts:104`）：`if (first && chunk.delta)` 只认文本 delta，工具调用场景首个分片是 `toolCallDelta`（delta 恒 `""`），`first` 永不清零。实测纯 tool_call 流 `recordMetrics.ttftMs === 0`。首 token 延迟漏计，计量精度缺失。
2. **`parseAssistantResponse` 分片缺 id/name 时产出 `tool_call_id:""`**（`agent.ts:56-62` + `:69-71`）：若 DeepSeek 首分片异常未带 `id`/`name`，重组出 `{id:"",name:""}`，回灌 `tool_call_id:""` 会触发下一轮 API 400。DeepSeek 正常总带 id/name，属防御性缺失。
3. **`maxIterations <= 0` 未处理**（`agent.ts:95`）：传 0 或负数时 `for` 循环体一次不执行，直接 `yield done`（`finalUsage` 为 undefined）。边界未防呆。

### INFO

1. **跨包 import 依赖 dist 产物**（实测：移走 `llm-driver/dist` 后 agent typecheck 报 `TS2307 Cannot find module 'minex-llm-driver'`）。但这是**既有全局模式**（kernel 同样 `exports` 指向 dist，所有 driver 均依赖 kernel dist），非本轮引入；report-34 已知限制「与 kernel 同模式」属实，接受。建议后续统一改用 tsconfig `paths` 指向源码，消除「必须先 build 才能 typecheck/test」的依赖（与 A1 纪律的独立性有张力）。
2. **assistant 带 tool_calls 时 content 为 `""` 空字符串**（`agent.ts:151`）：OpenAI/DeepSeek 协议中带 `tool_calls` 的 assistant 消息 `content` 通常为 `null`，空字符串是否被服务端接受需实测确认。
3. **`rework` 返回非 `role:"tool"` 消息会破坏协议顺序**（`agent.ts:174`）：hook 契约责任，默认透传安全，L2 替换时需保证返回合法回灌消息。
4. **`assembleWorkMemory`（S5b 的 W 层 hook）与 `rework`（S5d 的工具结果 hook）是两套未打通**：S5b 的 W 层填充能力在 S5d 完全未使用（`workMemory` 恒空），与 MAJOR-1 同源。
5. **计量集成无测试断言**：`agent.test.ts` 中 `recordMetrics` 均为空函数（`makeDeps`），10 用例覆盖了 loop 停止/rework/纯函数，但**未断言** `recordMetrics` 被正确调用、`cost/hitRate/ttftMs` 值正确（任务清单第 6 条「计量集成」无对应测试）。
6. **`stream` 消费方中途 break 时 reader 未 cancel**（`deepseek.ts:90`，沿用 S5a）。

---

## 四、上一轮问题回归（review-phase32 → report-33 修复）

| review-phase32 问题 | 判定 | 验证 |
|---|---|---|
| MAJOR-1 usage 提取缺失 | ✅ 已修 | `parseSseLine(usage chunk)` 返回 `{usage:{promptTokens:100,completionTokens:50,cachedTokens:30}}`；mock fetch 跑 stream，末 chunk `usage={promptTokens:10,completionTokens:2,cachedTokens:1}` |
| MAJOR-2 role:"tool" 承载 schema | ✅ 已修 | `buildMessages` 去掉 tools，签名 `{systemPrompt,history,workMemory}`；工具走 `LLMRequest.tools`→`toDeepSeekTool` |
| MAJOR-3 两档价低估输出 | ✅ 已修 | `computeCost` 三档价，1M+1M 全未命中实测 `1.37`（正确） |
| MAJOR-4 parameters 键序不稳 | ✅ 已修 | `serializeToolDef` 键序不同实测 `a===b` 为 `true` |
| MINOR hitRate 未 clamp | ✅ 已修 | `computeHitRate(150,100)` 实测 `1`（clamp 生效） |

4 MAJOR + 1 MINOR **全部真实修复**，report-33/34 的「无回归」声明属实。

---

## 五、验收逐条判定（对照 task-s5d.md）

| 条目 | 判定 | 说明 |
|---|---|---|
| 三连全绿 | ✅ | typecheck(9 包) / build / test(190) 实测 exit 0 |
| 1. 建包 agent-driver（id `minex.agent`，依赖 `minex.llm`） | ✅ | manifest/tsconfig/根脚本均已纳入 |
| 2. 扩展 ChatMessage（tool_call_id/tool_calls/ToolCall） | ✅ | 类型齐全，LLMChunk 加 toolCallDelta/usage |
| 3. 工具类型 + 注册（AgentTool + echo + ctx.query） | ✅ | `ctx.register("tool","echo",echoTool)` + `ctx.query<AgentTool>("tool")` |
| 4. agent loop（runAgent + 纯函数） | ✅ | ReAct 串行、分片重组、回灌正确 |
| 5. 再加工 hook（rework 默认透传） | ✅ | `defaultRework` + 可注入，测试覆盖 |
| 6. 计量集成（usage→cost→record） | ◐ | 主链路正确，但 `ttftMs` 纯 tool_call 场景恒 0（MINOR-1），且无测试断言（INFO-5） |
| 7. 测试（10 用例 mock provider） | ✅ | 覆盖纯函数 + loop 停止 + rework |
| 验收：mock 跑通 echo loop | ✅ | 测试「工具执行后继续循环直到无 tool_call」覆盖 |
| 验收：每次调用后 metrics 有记录 | ◐ | 逻辑上 recordMetrics 被调，但无断言验证（INFO-5） |

---

## 六、结论与修复优先级

本轮 S5d **无 BLOCKER**，ReAct loop 主链路正确、三连全绿、上一轮 4 MAJOR 已真实修复。唯一 MAJOR 是**架构分层矛盾**（工具结果进 S 层 vs S5b「进 W 层」设计），非逻辑 bug，但触及核心决策 D7「S 层严守缓存」，且影响后续 S5f 并行调度器下工具结果如何组织。

**修复优先级：**

1. **MAJOR-1（S/W 层边界 + 缓存纪律）** —— 唯一需 designer 决策的事项，建议在 S5f 前定案：明确 ReAct 下「工具往返历史」与「W 层工作记忆」的边界，避免缓存策略与分层文档继续漂移。
2. **MINOR-1（ttftMs 计量）+ INFO-5（计量测试缺口）** —— 一并补齐：`first` 判定纳入 toolCallDelta 首个分片；为 `recordMetrics` 增加断言，覆盖 cost/hitRate/ttftMs 值。
3. MINOR-2/3（tool_call_id 空值防御、maxIterations≤0 防呆）—— 小改，随下次顺手修。
4. INFO-1（typecheck 依赖 dist）—— 非本轮引入，建议排入后续「构建基建」专项统一解决。
