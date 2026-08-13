# 任务清单 · S5d（agent 驱动雏形：ReAct loop + 工具回灌 + 再加工 hook）

> 依据 `s5-agent-design.md`（第三节 MessageAssembler / 3.4 落地要点 + design-ideas #10/#13）。
> 前置：S5a-c 已交付（含 4 个 MAJOR 修复）。验证三连：`npm run typecheck && npm run build && npm test`。
> 本阶段目标：跑通最小 agent 闭环——LLM 决策 → 工具调用 → 结果回灌 → 再循环，直到产出最终答案。**串行工具执行**（调度器 S5f 才做并行）。

## 1. 建包
- `packages/agent-driver/`：package.json（name `minex-agent-driver`）、tsconfig（纯 TS）、manifest.json（id `minex.agent`，`dependencies: ["minex.llm"]`）。
- 根 package.json 的 build/typecheck 脚本纳入该包。

## 2. 扩展 ChatMessage 类型（改 `packages/llm-driver/src/types.ts`）
- `ChatMessage` 加 `tool_call_id?: string`（role="tool" 消息用）与 `tool_calls?: ToolCall[]`（role="assistant" 消息用）。
- `ToolCall = { id: string; name: string; arguments: string }`（arguments 是 JSON 字符串）。

## 3. 工具类型 + 注册（src/tool.ts）
- `AgentTool = { name: string; description: string; parameters: Record<string, unknown>; execute(args: Record<string, unknown>): Promise<string> }`
- 驱动入口注册 `ctx.register("tool", name, tool)`；agent loop 经 `ctx.query<AgentTool>("tool")` 查全部工具。
- 内置一个示例工具 `echo`（参数 `{ text: string }`，返回原文本）——验证 loop 用，后续接 filesystem 等真实工具。

## 4. agent loop（src/agent.ts）
- `runAgent(ctx, opts: { systemPrompt: string; history: ChatMessage[]; maxIterations?: number }): AsyncIterable<AgentEvent>`
- `AgentEvent = { kind: "text"; delta: string } | { kind: "toolCall"; name: string; args: unknown } | { kind: "done"; usage?: LLMUsage } | { kind: "error"; message: string }`
- 循环（ReAct 基板，串行）：
  1. 组装 messages：`buildMessages({ systemPrompt, history, workMemory })` + 工具走 `tools` 参数（`toDeepSeekTool`）。
  2. 调 `llm` 能力 `stream`，累积 assistant 文本 + 解析 `tool_calls`。
  3. 无 tool_call → 产出 `done`，结束；有 tool_call → 逐个 `execute`，工具结果经**再加工 hook** 后回灌 history（assistant 带 tool_calls + tool 结果带 tool_call_id）。
  4. 达 `maxIterations`（默认 10）→ 强制结束。
- **纯函数抽离**：`parseAssistantResponse(payload): { text: string; toolCalls: ToolCall[] }`（解析流末累积的完整响应）；`buildToolResultMessage(toolCallId, result): ChatMessage`（role="tool" + tool_call_id + content）。

## 5. 再加工 hook（W 层，design-ideas #13）
- `reworkHook(ctx, toolResult: ChatMessage): ChatMessage[]` —— 挂在「工具结果回灌」路径，**默认透传**（返回 `[toolResult]`），后续 L2 替换为提炼/压缩。
- agent loop 用可注入的 `rework` 参数（默认透传）。

## 6. 计量集成
- 每次 `stream` 结束后，用末 chunk 的 `usage` → `computeCost`/`computeHitRate` → `llm.metrics.record`。

## 7. 测试（test/agent.test.ts，mock provider 不真实调 API）
- `parseAssistantResponse`：纯文本 / 单 tool_call / 多 tool_call / 空。
- `buildToolResultMessage`：role="tool" + tool_call_id + content 正确。
- loop 停止：无 tool_call 结束、maxIterations 强制结束、工具执行后继续循环直到无 tool_call。
- 再加工 hook：默认透传；注入自定义 hook 时结果按 hook 输出回灌。

## 验收
- 三连全绿。
- mock provider 下跑通：用户问「echo 一下 hello」→ loop 调 echo 工具 → 回灌 → LLM 产出最终答案 → `done`。
- 每次调用后 metrics 有记录（usage/cost/hitRate）。
