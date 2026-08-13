# Minex 阶段报告 34（2026-08-13）—— S5d：agent 驱动雏形（ReAct loop + 工具回灌 + 再加工 hook）

> 报告制度（固定四节）。本轮内容：按 `docs/task-s5d.md` 完成 agent 驱动雏形——扩展 ChatMessage 工具类型、工具注册、ReAct loop、再加工 hook、计量集成。
> 前置：`docs/report-33.md`（S5a-c 审查修复）→ `docs/task-s5d.md`。

---

## 一、上次问题回归

- S5a-c 的 4 个 MAJOR + MINOR 已在 report-33 修复，本轮无回归。
- 回归面：三连保持全绿（本轮实测 22 文件 / 190 测试）。

---

## 二、本轮目标与内容

| # | 内容 | 定位 |
|---|---|---|
| 1 | 扩展 ChatMessage 类型 | `llm-driver/types.ts` 加 `tool_call_id`/`tool_calls`/`ToolCall`/`ToolCallDelta`；LLMChunk 加 `toolCallDelta` |
| 2 | deepseek 产出 tool_calls | `parseSseLine` 加 toolCall 分片分支；stream yield toolCallDelta |
| 3 | 建 agent-driver 包 | package/tsconfig/manifest（id `minex.agent`，依赖 `minex.llm`） |
| 4 | 工具类型 + 注册 | `tool.ts`：AgentTool + echo 示例；`index.ts` 注册 `tool` |
| 5 | agent loop | `agent.ts`：runAgent（ReAct 串行）+ parseAssistantResponse + buildToolResultMessage |
| 6 | 再加工 hook | `rework` 可注入（默认透传） |
| 7 | 计量集成 | stream 结束 → computeCost/computeHitRate → recordMetrics |

---

## 三、具体实现

### 文件清单与联系

| 文件 | 职责 |
|---|---|
| `llm-driver/src/types.ts` | ChatMessage 加 tool_call_id/tool_calls；ToolCall/ToolCallDelta；LLMChunk 加 toolCallDelta |
| `llm-driver/src/deepseek.ts` | parseSseLine 加 toolCall 分支；stream yield toolCallDelta |
| `llm-driver/src/index.ts` + package.json | re-export 纯函数/类型 + exports（供 agent 跨包 import） |
| `agent-driver/src/tool.ts` | AgentTool 类型 + echo 示例工具 |
| `agent-driver/src/agent.ts` | parseAssistantResponse/buildToolResultMessage/defaultRework/runAgent |
| `agent-driver/src/index.ts` | 注册 tool + agent 能力（收集 llm/config/metrics/tool 依赖） |
| `agent-driver/test/agent.test.ts` | 10 用例（mock provider） |
| `package.json` | 根脚本纳入 agent-driver |

### 关键代码定位（file:line，供审查对照）

| 改动点 | 定位 |
|---|---|
| ChatMessage/ToolCall/ToolCallDelta 类型 | `llm-driver/src/types.ts:5-40` |
| parseSseLine toolCall 分支 | `llm-driver/src/deepseek.ts:10-54` |
| stream yield toolCallDelta | `llm-driver/src/deepseek.ts:110-114` |
| re-export + exports | `llm-driver/src/index.ts:7-12` + package.json |
| parseAssistantResponse（分片重组） | `agent-driver/src/agent.ts:53-70` |
| buildToolResultMessage / defaultRework | `agent-driver/src/agent.ts:73-80` |
| runAgent（ReAct 串行 loop） | `agent-driver/src/agent.ts:86-180` |
| 计量集成（computeCost/computeHitRate） | `agent-driver/src/agent.ts:135-145` |
| 工具注册 + agent 能力 | `agent-driver/src/index.ts:24-48` |

### 数据流

```
agent.run(systemPrompt, history) → runAgent
  buildMessages(systemPrompt + history) + 工具走 tools 参数
  → llm.stream 累积 text + toolCallDelta 分片
  → parseAssistantResponse 重组 toolCalls
  → 无 tool_call：done + usage → 计量记录
  → 有 tool_call：逐个 execute → 结果经 rework → buildToolResultMessage 回灌 history → 再循环
  → 达 maxIterations 强制结束
```

### 关键设计

1. **ReAct 串行基板**：LLM 决策 → 工具执行 → 结果回灌 → 再循环；调度器（S5f）才做并行。
2. **工具调用分片重组**：DeepSeek 流式 tool_calls 按 index 分片，`parseAssistantResponse` 用 Map 按 index 累积 arguments、id/name 补全、排序——纯函数可测。
3. **跨包复用走 exports**：llm-driver 加 `exports`（dist）+ re-export，agent-driver 经 `import "minex-llm-driver"` 复用 buildMessages/computeCost/computeHitRate 与类型（避免重复实现）。
4. **再加工 hook**：`rework` 可注入（默认透传），挂在工具结果回灌路径（W 层）。
5. **计量**：每次 stream 结束用末 chunk usage → cost/hitRate → recordMetrics。

---

## 四、审查标准

### 必须通过（已亲自验证，外部复核）

1. 三连全绿：`typecheck exit 0`（**9 包**，含 agent-driver）／`build exit 0`／`test 190/190`（22 文件，新增 agent 10 用例）。
2. `parseAssistantResponse`：纯文本 / 单 tool_call（多分片重组）/ 多 tool_call（按 index 排序）/ 空。
3. `buildToolResultMessage`：role=tool + tool_call_id + content。
4. loop 停止：无 tool_call 结束、maxIterations 强制结束、工具执行后继续循环直到无 tool_call。
5. 再加工 hook：默认透传；注入自定义 hook 时结果按 hook 输出回灌。

### 重点审查

- **P0 工具调用往返**：assistant 带 tool_calls 回灌 + tool 结果带 tool_call_id 回灌（协议正确）。
- **P0 跨包 import**：llm-driver exports 指向 dist；agent-driver 经包名 import（依赖 dist 残留，与 kernel 同模式）。
- **P1 分片重组**：arguments 拼接、id/name 补全、index 排序。
- **P1 计量**：stream 结束记录 usage/cost/hitRate；ttftMs 首 token 延迟。

### 已知限制（勿误报）

- **串行工具执行**（任务清单明确；S5f 调度器才并行）。
- `ChatMessage` 的 tool_calls 仅在 agent 回灌时用；DeepSeek 实际流式 tool_calls 已由 stream 分片捕获。
- `agent` 能力无 UI 贡献（不进顶栏选择器）；接入会话/工作区 UI 属后续阶段。
- echo 为示例工具，真实工具（filesystem 等）后续注册到 `tool` 能力。
- metrics 记录依赖 llm.metrics 能力（缺省时 recordMetrics no-op，由 index.ts 的 `metrics?.record` 保证）。
- 价格表未配置时成本为 0（config 无默认值，任务清单要求）。

---

**提交状态**：本轮改动独立提交：`feat(agent): S5d agent 驱动雏形（ReAct loop + 工具回灌 + 再加工 hook）`。
