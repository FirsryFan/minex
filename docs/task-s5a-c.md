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
- `LLMChunk = { delta: string; done: boolean }`
- `LLMUsage = { promptTokens: number; completionTokens: number; cachedTokens: number }`
- `LLMProvider = { stream(req: LLMRequest): AsyncIterable<LLMChunk> }`

### 3. DeepSeek 实现（src/deepseek.ts）
- `createDeepSeekProvider(apiKey: string): LLMProvider`
- 请求：`POST https://api.deepseek.com/chat/completions`，`Authorization: Bearer <key>`，body 含 `model/messages/tools/stream:true/params`。
- 流式：解析 SSE `data:` 行 → `choices[0].delta.content`；`[DONE]` 结束。
- usage：从流末 chunk 提取 `usage`（`prompt_tokens`/`completion_tokens`/`prompt_cache_hit_tokens`）。
- 抽纯函数：`parseSseLine(line: string): { delta: string } | { done: true } | null`；`extractUsage(payload: unknown): LLMUsage`。

### 4. config + 注册（src/index.ts）
- 注册 `llm.config` 能力：`get/set apiKey|model|params`（storage 命名空间 `minex.llm`）。
- 注册 `llm` 能力：从 config 读 apiKey 建 provider，`ctx.register("llm", "deepseek", provider)`；无 key 时 `stream` 抛「未配置 API key」。

### 5. 测试（test/deepseek.test.ts）
- `parseSseLine`：delta 行 / [DONE] / 非法行。
- `extractUsage`：含命中 / 不含命中字段（cachedTokens=0）。

---

## S5b · MessageAssembler：S/W/P 三层 + 稳定前缀

### 1. 纯函数（src/assembler.ts）
- `serializeToolDef(t: ToolDef): string` —— 固定字段顺序（name→description→parameters）的 JSON，字节级稳定。
- `buildMessages(input: { systemPrompt: string; tools: ToolDef[]; history: ChatMessage[]; workMemory: ChatMessage[] }): ChatMessage[]`
  - 顺序：`[system] → [tool(序列化后的描述)] → history → workMemory`。
  - system/tools/history 是 S 层（稳定）；workMemory 是 W 层（末尾）。
- `assembleWorkMemory(ctx: unknown): ChatMessage[]` —— 再加工 hook，默认透传传入内容（返回 `ctx` 本身或其 message 数组）。

### 2. 测试（test/assembler.test.ts）
- `serializeToolDef` 两次调用输出完全一致（字节级稳定）。
- `buildMessages` 顺序正确、history 原样 append、workMemory 在末尾。
- `assembleWorkMemory` 默认透传。

---

## S5c · LLMMetrics：计量

### 1. 纯函数 + 类型（src/metrics.ts）
- `LLMMetricsEntry = { model: string; promptTokens: number; completionTokens: number; cachedTokens: number; ttftMs: number; totalMs: number; cost: number; hitRate: number }`
- `computeCost(usage: LLMUsage, prices: { hit: number; miss: number }): number` —— 命中 token × hit 价 + 未命中 token × miss 价（价格以「每 1M token 美元」传入，输出美元）。
- `computeHitRate(cachedTokens: number, promptTokens: number): number` —— `cached / prompt`（prompt=0 时返回 0）。

### 2. 价格表 + 记录（src/index.ts）
- 价格表由 config 提供，**按模型区分** hit/miss 价（单位：每 1M token 美元）；不写死默认值。
- 注册 `llm.metrics` 能力：`record(entry)` 追加到 storage `minex.llm/metrics`；`list(model?)` 读取聚合。

### 3. 测试（test/metrics.test.ts）
- `computeCost`：全命中 / 全未命中 / 混合。
- `computeHitRate`：0 / 50% / 100% / prompt=0。

---

## 验收

- 三连全绿。
- CLI 冒烟（可选）：配置 key 后调 `llm` 能力 stream 一段文本，打印 metrics（token/缓存命中/成本）。
