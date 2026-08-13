# Minex 阶段报告 42（2026-08-13）—— S5 收尾（S5g 接线 + S5f 接入 loop）

> 报告制度（固定四节）。本轮内容：按 `docs/task-s5-final.md` 完成两处接线——S5g 注册 `workflow` 能力（白名单解释器可实际调用）、S5f `execute` 并行接入 ReAct loop 工具执行。
> 前置：`docs/report-41.md` → `docs/task-s5-final.md`。

---

## 一、上次问题回归

- S5g 修复（task-s5g-fix 六项）已在 report-41 完成，本轮无回归。
- 回归面：三连保持全绿（本轮实测 27 文件 / 239 测试）。

---

## 二、本轮目标与内容

| # | 内容 | 定位 |
|---|---|---|
| 1 | S5g 接线 | `index.ts` 调 `createBuiltinRegistry(ctx)` + 注册 `workflow` 能力（validate + execute） |
| 2 | S5f 接入 loop | `agent.ts` 工具执行从串行 for 改为 `scheduler.execute` 并行 |
| 3 | 测试 | agent 并行测试 + workflow 接线测试 |

---

## 三、具体实现

### 文件清单与联系

| 文件 | 职责 |
|---|---|
| `agent-driver/src/index.ts` | 注册 `workflow` 能力（createBuiltinRegistry + validateWorkflow + executeWorkflow） |
| `agent-driver/src/agent.ts` | import execute/Task；RunAgentOptions 加 maxConcurrent（默认 4）；工具执行改并行 |
| `agent-driver/test/agent.test.ts` | +1 并行执行测试 |
| `agent-driver/test/interpreter.test.ts` | +1 workflow 接线测试 |

### 关键代码定位（file:line，供审查对照）

| 改动点 | 定位 |
|---|---|
| workflow 能力注册 | `agent-driver/src/index.ts:40-47` |
| 工具并行执行（execute + 声明序回灌） | `agent-driver/src/agent.ts:156-200` |
| maxConcurrent 参数 | `agent-driver/src/agent.ts:25-27 / 181` |
| 并行测试 / 接线测试 | `agent.test.ts` / `interpreter.test.ts` |

### 数据流

```
S5g：workflow.run(wf, { maxLoopIterations })
  → validateWorkflow(wf, registry) → executeWorkflow(wf, ctx, { registry, maxLoopIterations })

S5f：runAgent 一轮内 toolCalls
  → 先按声明序 yield toolCall 事件 → 转 Task[] → execute(并行, maxConcurrent)
  → 结果按声明序回灌（rework(buildToolResultMessage)）
```

### 关键设计

1. **S5g 可实际调用**：`workflow` 能力经 `createBuiltinRegistry`（桥接 tool/envelope/pool/session）→ `executeWorkflow`，模型数据不再「代码存在但不可用」。
2. **工具并行执行**：LLM 一次产出的多个 tool_calls 之间无数据依赖，`scheduler.execute` 并行（maxConcurrent 默认 4）；事件先按声明序 yield（UI 顺序稳定）、结果按声明序回灌（缓存友好）。

---

## 四、审查标准

### 必须通过（已亲自验证，外部复核）

1. 三连全绿：`typecheck exit 0`（9 包）／`build exit 0`／`test 239/239`（27 文件）。
2. agent：一次产出多个无依赖工具时并行执行（并发计数 ≥2）；结果按声明顺序回灌。
3. workflow：经 `workflow.run` 实际执行（callTool 桥接 echo）；`eval` 仍被拒（安全不回退）。

### 重点审查

- **P0 并行正确性**：tool_calls 无依赖并行；结果按声明序回灌（不因完成序错位）。
- **P0 接线**：workflow 能力 = validate + execute，白名单（createBuiltinRegistry）生效。
- **P1 错误兜底**：工具未找到/执行抛错 → 返回 `Error: ...` 字符串（不中断整层）。

### 已知限制（勿误报）

- `maxConcurrent` 默认 4，agent 能力的 `run` 签名尚未暴露该参数（index.ts 的 agent.run 只传 systemPrompt/history/maxIterations；可后续补 maxConcurrent 透传）。
- `createBuiltinRegistry` 的 session 桥接（readSession/writeSession）依赖 session 能力就绪（已注册，但接线测试 mock 未覆盖）。

---

**提交状态**：本轮改动独立提交：`feat(agent): S5 收尾（S5g 接线 + S5f 并行接入 loop）`。
