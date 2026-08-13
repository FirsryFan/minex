# 任务清单 · S5a-c（LLM 接入层）

> 依据 `s5-agent-design.md`。每个任务产出可编译代码 + 纯函数测试。验证三连：`npm run typecheck && npm run build && npm test`。

## S5a · llm-driver：Provider 抽象 + DeepSeek 实现

### 1. 建包
- `packages/llm-driver/`：package.json（name `minex-llm-driver`）、tsconfig（纯 TS，无 jsx）、manifest.json（id `minex.llm`，无 dependencies）。
- 根 package.json 的 build/typecheck 脚本纳入该包。

### 2. 类型（src/types.ts）
- `ChatMessage = { role: "system" | "user" | "assistant" | "tool"; content: string }`
- `ToolDef = { name: string; description: string; parameters: Record<string, unknown> }`
- `LLMRequest = { model: string; messages: ChatMessage[]; tools?: ToolDef[]; params?: Record<string, unknown>; stream?: boolean }`
- `LLMChunk = { delta: string; done: boolean; usage?: LLMUsage }`  // usage 可选，仅流末 chunk 携带
- `LLMUsage = { promptTokens: number; completionTokens: number; cachedTokens: number }`
- `LLMProvider = { stream(req: LLMRequest): AsyncIterable<LLMChunk> }`

### 3. DeepSeek 实现（src/deepseek.ts）
- `createDeepSeekProvider(apiKey: string): LLMProvider`
- 请求：`POST https://api.deepseek.com/chat/completions`，`Authorization: Bearer <key>`，body 含 `model/messages/tools/stream:true/params`。
- 流式：解析 SSE `data:` 行 → `choices[0].delta.content`；`[DONE]` 结束。
- usage：流末 usage chunk（`choices: []` 且含 `usage`）→ `extractUsage` 产出，作为 `{ delta: "", done: true, usage }` 的最后一个 chunk；**流末无 usage 时兜底 `usage = { promptTokens: 0, completionTokens: 0, cachedTokens: 0 }`**。
- 抽纯函数：`parseSseLine(line: string): { delta: string } | { usage: unknown } | { done: true } | null`；`extractUsage(payload: unknown): LLMUsage`。

### 4. config + 注册（src/index.ts）
- 注册 `llm.config` 能力：`get/set apiKey|model|params`（storage 命名空间 `minex.llm`）。
- 注册 `llm` 能力：从 config 读 apiKey 建 provider，`ctx.register("llm", "deepseek", provider)`；无 key 时 `stream` 抛「未配置 API key」。

### 5. 测试（test/deepseek.test.ts）
- `parseSseLine`：delta 行 / [DONE] / 非法行。
- `extractUsage`：含命中 / 不含命中字段（cachedTokens=0）。

---

## S5b · MessageAssembler：S/W/P 三层 + 稳定前缀

### 1. 纯函数（src/assembler.ts）
- `serializeToolDef(t: ToolDef): string` —— 对 `parameters` **递归稳定键排序**后 stringify，保证字节级稳定（顶层 + 嵌套）。
- `buildMessages(input: { systemPrompt: string; history: ChatMessage[]; workMemory: ChatMessage[] }): ChatMessage[]`
  - 顺序：`[system] → history → workMemory`。工具 schema **不走 message**（走 `LLMRequest.tools` 参数，见 S5a）。
  - system/history 是 S 层（稳定）；workMemory 是 W 层（末尾）。
- `assembleWorkMemory(ctx: unknown): ChatMessage[]` —— 再加工 hook，默认透传传入内容。

### 2. 测试（test/assembler.test.ts）
- `serializeToolDef` 对同一 schema 的不同 `parameters` 键序输出**完全一致**（字节级稳定，含嵌套）。
- `buildMessages` 顺序正确、history 原样 append、workMemory 在末尾、无 `role:"tool"` 消息。
- `assembleWorkMemory` 默认透传。

---

## S5c · LLMMetrics：计量

### 1. 纯函数 + 类型（src/metrics.ts）
- `LLMMetricsEntry = { model: string; promptTokens: number; completionTokens: number; cachedTokens: number; ttftMs: number; totalMs: number; cost: number; hitRate: number }`
- `computeCost(usage: LLMUsage, prices: { inputHit: number; inputMiss: number; output: number }): number` —— 缓存命中 token × inputHit + 未命中输入 token × inputMiss + 输出 token × output（单位：每 1M token 美元，输出美元）。
- `computeHitRate(cachedTokens: number, promptTokens: number): number` —— `cached / prompt`（prompt=0 返回 0，结果 clamp 到 [0,1]）。

### 2. 价格表 + 记录（src/index.ts）
- 价格表由 config 提供，**按模型区分** inputHit/inputMiss/output 三档价；不写死默认值。
- 注册 `llm.metrics` 能力：`record(entry)` 追加到 storage `minex.llm/metrics`；`list(model?)` 读取聚合。

### 3. 测试（test/metrics.test.ts）
- `computeCost`：全命中 / 全未命中 / 混合 / 输出按 output 价计。
- `computeHitRate`：0 / 50% / 100% / prompt=0 / cached>prompt（clamp 到 1）。

---

## 验收

- 三连全绿。
- CLI 冒烟（可选）：配置 key 后调 `llm` 能力 stream 一段文本，打印 metrics（token/缓存命中/成本）。
