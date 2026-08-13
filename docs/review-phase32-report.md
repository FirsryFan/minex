# Minex 阶段 32 审查报告（S5a-c：LLM 接入层）

> 审查日期：2026-08-13　|　范围：`packages/llm-driver`（Provider 抽象 + DeepSeek / MessageAssembler / Metrics）
> 对照：`docs/s5-agent-design.md` + `docs/task-s5a-c.md` + `docs/report-32.md`

## 审查基线

三连本人实测（Windows Git Bash，cwd `E:/Minex`）：

**`npm run typecheck`** — exit 0（8 包，含 llm-driver）

```
> tsc --noEmit   (×8，对应 kernel / filesystem / llm / mist-session / appearance / markdown / cli / ui-shell)
===TYPECHECK_EXIT:0===
```

**`npm run build`** — exit 0

```
> tsc   (×7)
> tsc --noEmit && vite build
✓ 2072 modules transformed.
✓ built in 6.13s
(!) 部分 chunk 超过 500kB（ui-shell index 1.45MB），仅为 rollup 体积警告，非错误。
===BUILD_EXIT:0===
```

**`npm test`** — exit 0（21 文件 / 176 测试全绿，其中 llm-driver：assembler 8 + deepseek 6 + metrics 7 = 21 用例）

```
✓ packages/llm-driver/test/assembler.test.ts (8 tests)
✓ packages/llm-driver/test/deepseek.test.ts (6 tests)
✓ packages/llm-driver/test/metrics.test.ts (7 tests)
 Test Files  21 passed (21)
      Tests  176 passed (176)
===TEST_EXIT:0===
```

> 三连中的 3 处 stderr（registry/lifecycle/events 的 "throwing handler does not block others"）是内核既有测试的**预期日志**，非失败。三连结果与 report-32 声明一致。

---

## 一、BLOCKER（必须修）

**无。**

未发现逻辑错误 / 数据不一致 / 资源泄漏级别的硬伤。内核侧隔离语义已核实正确：`ctx.storage = storage.namespace(manifest.id)`（`kernel.ts:79`），故 llm-driver 内 `get("apiKey")/get("metrics")` 用相对 key 无跨驱动串扰风险（历史教训 E1/E3 不成立）；`ctx.register` 默认 runtime 贡献，停用即清（B2 无残留）。manifest `minKernelVersion 0.2.3` 与 kernel 实测 `0.2.3` 匹配，loader 不会拒绝激活。

---

## 二、MAJOR（建议修）

### MAJOR-1　stream 未提取 usage —— S5a-3 任务要求未完成，S5c 计量上游数据断层

- **位置**：`packages/llm-driver/src/deepseek.ts:41-92`（`stream`）+ `:10-23`（`parseSseLine`）
- **根因**：任务清单 S5a-3 第 4 条明确「usage：从流末 chunk 提取 usage（prompt_tokens/completion_tokens/prompt_cache_hit_tokens）」；设计文档 S5a 也声明「DeepSeek 实现内含…缓存计费字段」。实现虽加了 `stream_options: { include_usage: true }` 让服务端返回 usage，但 `parseSseLine` 对 usage chunk（`choices: []`）返回 `null`，`extractUsage` 在整个 stream 路径**从未被调用**，usage 被静默丢弃。
- **实测证据**：
  ```
  parseSseLine(`data: {"choices":[],"usage":{"prompt_tokens":100,...}}`)  =>  null
  ```
  mock fetch 跑完整 `stream`：chunks = `[{delta:"你"},{delta:"好"},{delta:"",done:true}]`，**无任何 usage 字段**（`chunks.some(c => "usage" in c) === false`）。
- **后果**：S5c 的 `record(entry)` 需要的 `promptTokens/completionTokens/cachedTokens/cost/hitRate` 全部没有真实数据源。设计文档 S5c 明确「S5c 必须先于 S5d（否则无基线）」，而此缺口使「计量基线」成为无源之水。
- **归属**：report-32 将其降级为「已知限制（LLMChunk 不含 usage，stream 不做 usage 追踪）」，但这是**单方面把任务清单的明确要求降级**，未经 designer 裁决，且与 S5a-3 文本直接冲突。属「任务要求 vs 实现缺口」。
- **修复方向**：二选一——(a) 扩展 `LLMChunk`（或 provider 增加 `streamWithUsage`），让 stream 从 usage chunk 调 `extractUsage` 产出 usage；(b) designer 明确接受「usage 延后到 S5d 组合」。当前「已知限制」措辞不足以替代 S5a-3 的交付承诺。

### MAJOR-2　`buildMessages` 用 `role:"tool"` 承载工具 schema —— 违反 DeepSeek/OpenAI 协议语义

- **位置**：`packages/llm-driver/src/assembler.ts:28-37`
- **根因**：`buildMessages` 把 `serializeToolDef(t)` 塞成 `{ role: "tool", content: "<工具 schema JSON>" }`。但 LLM 协议中 `role:"tool"` 是**工具调用结果**，必须关联 `tool_call_id`；工具**定义**应通过独立的 `tools` 参数传递（stream 里已有 `toDeepSeekTool` 正确实现 `{type:"function", function:{...}}`，`deepseek.ts:36-38`），不应作为 messages 里的 tool 消息。
- **实测证据**：
  ```
  buildMessages(...)  =>  [{role:"system",...},{role:"tool",content:"{\"name\":\"readFile\",...}"},...]
  tool 消息 keys: [role, content]  |  tool_call_id = undefined
  ```
- **后果**：S5d 接入时若把 `buildMessages` 输出作为 `req.messages`，会因 `role:"tool"` 缺 `tool_call_id` 触发 API 400，或工具 schema 被模型误读为一条工具结果。且 `ChatMessage` 类型（`types.ts:5-8`）只有 `role/content`，缺 `tool_call_id`/`tool_calls`，根本无法表达真实工具调用往返。
- **归属**：任务清单 S5b 明确要求此顺序 `[system]→[tool(序列化后的描述)]→history→workMemory`，故这是**任务清单自身的设计语义错误**（designer 未意识到 `role:"tool"` 在协议中的特定含义），需 designer 澄清「工具 schema 如何进入消息」。
- **修复方向**：工具 schema 走 `tools` 参数（不占 message 位）；若确需进 S 层稳定前缀，应作为 system 内容的一部分（如「可用工具：<json>」），而非 `role:"tool"` 消息。

### MAJOR-3　`computeCost` 两档价把输出 token 与输入 miss 混价 —— 成本系统性低估 ~61%

- **位置**：`packages/llm-driver/src/metrics.ts:25-29` + `LLMPrices`（`:16-19`）
- **根因**：`LLMPrices` 只有 `hit/miss` 两档，`miss = prompt - cached + completion` 把 completion（**输出**）按输入 miss 价计。真实 DeepSeek-chat 定价：输入缓存命中 $0.07 / 输入缓存未命中 $0.27 / **输出 $1.10**（每 1M token）。输出价约为输入 miss 价的 4 倍。
- **实测证据**（prompt=completion=1M，全未命中）：
  ```
  两档价模型成本（输出按 miss 计）= 0.54 美元
  真实三档成本（输出按 output 价）  = 1.37 美元
  低估比例 = 0.61
  ```
- **后果**：S5c 的核心目标「计量」产出的成本数字严重失真——正是历史教训 F1「特效真、效果假」的同类：计量功能在，数字是错的。
- **归属**：任务清单 S5c 明确 `prices: {hit, miss}` 两档，故属**设计精度缺陷**，需 designer 决策。
- **修复方向**：`LLMPrices` 扩为三档（`inputHit`/`inputMiss`/`output` 或 `hit`/`miss`/`output`），`computeCost` 对 completion 用 output 价。

### MAJOR-4　`serializeToolDef` 仅固定顶层字段序，`parameters` 内部键序不稳定 —— 「字节级稳定」承诺不完整

- **位置**：`packages/llm-driver/src/assembler.ts:13-15`
- **根因**：`JSON.stringify({ name, description, parameters })` 只保证顶层 `name→description→parameters` 序；`parameters` 内部键序依赖调用方对象的插入序，不保证稳定。
- **实测证据**（同一 schema，parameters 键序不同）：
  ```
  serializeToolDef({ parameters:{ type, properties, required } })  // {"name":...,"parameters":{"type":"object","properties":{},"required":[]}}
  serializeToolDef({ parameters:{ required, properties, type } })  // {"name":...,"parameters":{"required":[],"properties":{},"type":"object"}}
  a === b  =>  false
  ```
- **后果**：违反 S5b「S 层字节级稳定（工具 schema 固定序列化）」与设计文档 D7「S 层严守缓存（append-only）」。工具 schema 构造方式一旦变化，缓存前缀失效。现有测试（`assembler.test.ts:7-11`）只覆盖**顶层**字段序，未覆盖 `parameters` 内部键序——测试覆盖缺口。
- **归属**：任务清单 S5b-1 要求「字节级稳定」，实现只保证顶层，属**实现不完整**。
- **修复方向**：`serializeToolDef` 内对 `parameters` 递归做稳定键排序后 stringify；或在类型/文档层面明确约束「调用方保证 parameters 键序稳定」。

---

## 三、MINOR / INFO（可留 / 观察）

### MINOR

1. **`computeHitRate` 未 clamp 到 [0,1]**（`metrics.ts:32-35`）：`cached > prompt` 时命中率 > 100%。任务清单只要求 `prompt=0` 返回 0，未要求 clamp；数据异常场景下的防御性缺失。
2. **`llm.metrics.record` 全量读改写**（`index.ts:57-60`）：每次 `get("metrics")` 全量读 → push → `set` 全量写，且 JSON 文件存储每次 set 全量原子写盘（`storage.ts:92-95`）。记录增多后 O(n) 且磁盘 I/O 频繁。存储 API 同步，无并发竞态，主要是性能/可扩展性问题。
3. **config getter 类型强转**（`index.ts:33-40`）：`as string` / `as Record<...>` 若存储被外部写入非预期类型（如 apiKey 存成 object → `Bearer [object Object]`）会静默产生错误值。自控存储风险低，但无运行时校验。

### INFO

1. **`stream` 消费方中途 break 时 reader 未 cancel/releaseLock**（`deepseek.ts:66`）：底层连接资源不释放。流式 API 的通用边界，当前 `for await` 完整消费不受影响。
2. **`ChatMessage` 类型缺 `tool_call_id`/`tool_calls`**（`types.ts:5-8`）：无法表达真实工具调用往返，S5d 实现工具循环前需扩展契约（与 MAJOR-2 同源）。
3. **`llm.metrics.record` 不校验字段、不提供「从 usage 自动算 cost/hitRate」的便捷路径**：`computeCost`/`computeHitRate` 是纯函数供调用方（S5d）组合，`record` 只被动存储完整 entry，符合任务清单，但成本/命中率的填充责任完全外推，S5d 接入时需自行串起 usage → cost 的链路。
4. **`stream_options.include_usage` 依赖服务端行为**：DeepSeek 当前支持，但若服务端忽略该字段，usage 仍返回缺失——与 MAJOR-1 同源，补齐 usage 提取时需同时做「usage 缺失」的兜底（如 cachedTokens=0）。

---

## 四、上一轮问题回归

- **上一轮审查报告 review-phase30** 的三处全局单例（`doc` 固定 key / `openFile` 全局广播 / `lastOpenPath` 全局补开）由 **report-31** 声称修复（`doc@id` / `targetInstanceId` 定向 / `lastOpenPath@id` + `instanceId` 注入）。
- report-32 第一节「上次问题回归」声称「report-31 无遗留 BLOCKER/MAJOR，第 5 步 reload 占用为待办」。
- **⚠️ 需注意**：report-31（多实例隔离）的改动**本身尚未经过 checker 独立审查**（docs 中无 `review-phase31-report.md`）。report-32 的「无遗留」是 programmer 自述，三连全绿只能证明编译/测试通过，不能证明 report-31 的逻辑正确性已独立核实。
- 第 5 步（reload 运行时占用检查）在 report-31 / report-32 均声明为待办，一致。

**建议**：补审 report-31 的多实例隔离改动（`doc@id` / `openFile` 定向 / `lastOpenPath@id` / `instanceId` 注入，涉及 App.tsx 与三个驱动的面板），避免「上一轮未审、本轮当作已回归」的审查链断裂。

---

## 五、验收逐条判定

| 任务清单条目 | 判定 | 说明 |
|---|---|---|
| 三连全绿 | ✅ | typecheck(8 包) / build / test(176) 本人实测 exit 0 |
| S5a-1 建包（package/tsconfig/manifest + 根脚本纳入） | ✅ | manifest id `minex.llm`、纯 TS 无 jsx、根 build/typecheck 已纳入 |
| S5a-2 类型（6 个类型） | ✅ | 与任务清单逐一对应 |
| S5a-3 DeepSeek：parseSseLine / extractUsage 纯函数 | ✅ | 测试覆盖 delta/[DONE]/非法/无 content/缓存字段 |
| S5a-3 DeepSeek：「usage 从流末 chunk 提取」 | ❌ | stream 丢弃 usage chunk，`extractUsage` 未接入 stream → **MAJOR-1** |
| S5a-4 config + llm 能力（动态 key、无 key 抛错） | ✅ | 动态读 key、无 key 抛「未配置 API key」 |
| S5b serializeToolDef 字节级稳定 | ◐ | 顶层字段序稳定，`parameters` 内部键序不稳定 → **MAJOR-4** |
| S5b buildMessages 顺序 system→tool→history→workMemory | ◐ | 顺序正确，但 `role:"tool"` 承载 schema 违反协议 → **MAJOR-2** |
| S5b assembleWorkMemory 默认透传 | ✅ | 数组/`{messages}`/非法输入均覆盖 |
| S5c computeCost 全命中/未命中/混合 | ◐ | 数学正确，但两档价低估输出成本 → **MAJOR-3** |
| S5c computeHitRate 0/50%/100%/prompt=0 | ✅ | 四用例通过 |
| S5c llm.metrics 注册 record/list | ✅ | 追加 + 按 model 过滤 |
| CLI 冒烟（可选） | — | 未做（需真实 key），report 声明为已知限制，接受 |

---

## 六、结论与修复优先级

本轮 S5a-c **无 BLOCKER**，纯函数逻辑与三连基线正确。但存在 4 处 MAJOR，均非「纯静态推断」——每一条都附了临时脚本/协议的实测证据。其中两条是「任务清单自身的设计语义/精度缺陷」（需 designer 改任务清单），两条是「任务清单要求 vs 实现缺口」（需 programmer 补齐）：

**按序修复：**

1. **MAJOR-2（buildMessages `role:"tool"` 协议语义）** —— 最高优先，S5d 前必须定案：工具 schema 走 `tools` 参数还是进 system 内容，否则工具调用链路契约错、且 `ChatMessage` 类型需同步扩展 `tool_call_id`/`tool_calls`。
2. **MAJOR-1（usage 提取缺失）** —— S5d 前必须补齐：计量 S5c 是「必须先于 S5d」的基线，usage 断层使基线无数据源；需 designer 明确是扩展 `LLMChunk` 还是延后到 S5d。
3. **MAJOR-3（两档价低估输出成本 61%）** —— S5c 计量精度，建议 `LLMPrices` 扩三档（区分输出价）。
4. **MAJOR-4（serializeToolDef `parameters` 键序不稳定）** —— S 层缓存稳定性，建议稳定排序 `parameters`。

**另建议**：补审 report-31 多实例隔离改动（当前无 review-phase31，programmer 的「无遗留」声明未经独立核实）。
