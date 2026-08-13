# Minex 阶段报告 33（2026-08-13）—— 阶段 32 审查修复（4 MAJOR + MINOR）

> 报告制度（固定四节）。本轮内容：执行 `review-phase32-report.md`——4 个 MAJOR（usage 提取 / 工具 schema 位置 / 三档价 / parameters 键序）+ MINOR（hitRate clamp）。其中 MAJOR-1/2 经 designer 决策。
> 前置：`docs/report-32.md` → `docs/review-phase32-report.md`。

---

## 一、上次问题回归（review-phase32 四 MAJOR）

| 项 | 决策 | 修复 |
|---|---|---|
| **MAJOR-1** usage 提取缺失 | designer：扩展 LLMChunk 产出 usage | `LLMChunk` 加 `usage?`；`parseSseLine` 加 usage 分支；`stream` 流末产出 usage |
| **MAJOR-2** role:"tool" 承载 schema 违反协议 | designer：走 tools 参数 | `buildMessages` 去掉 tools，顺序 system→history→workMemory；工具走 `LLMRequest.tools` |
| **MAJOR-3** 两档价低估输出 61% | 三档价 | `LLMPrices` 扩 `inputHit/inputMiss/output`；`computeCost` 输出独立计价 |
| **MAJOR-4** parameters 键序不稳定 | 稳定排序 | `serializeToolDef` 对 parameters 递归稳定键排序 |
| MINOR-1 hitRate 未 clamp | clamp | `computeHitRate` clamp 到 [0,1] |

---

## 二、本轮目标与内容

| # | 内容 | 定位 |
|---|---|---|
| 1 | MAJOR-1 usage 提取 | `types.ts` LLMChunk 加 usage；`deepseek.ts` parseSseLine/stream |
| 2 | MAJOR-2 工具走 tools 参数 | `assembler.ts` buildMessages 去 tools |
| 3 | MAJOR-3 三档价 | `metrics.ts` LLMPrices + computeCost |
| 4 | MAJOR-4 parameters 稳定排序 | `assembler.ts` stableValue + serializeToolDef |
| 5 | MINOR hitRate clamp | `metrics.ts` computeHitRate |

---

## 三、具体实现

### 关键代码定位（file:line，供审查对照）

| 改动点 | 定位 |
|---|---|
| LLMChunk 加 usage | `llm-driver/src/types.ts:24-28` |
| parseSseLine usage 分支 | `llm-driver/src/deepseek.ts:16-34` |
| stream 流末产出 usage | `llm-driver/src/deepseek.ts:73-98` |
| buildMessages 去 tools | `llm-driver/src/assembler.ts:29-44` |
| stableValue 稳定排序 | `llm-driver/src/assembler.ts:8-20` |
| 三档 LLMPrices / computeCost | `llm-driver/src/metrics.ts:13-43` |
| computeHitRate clamp | `llm-driver/src/metrics.ts:47-51` |

### 关键设计

1. **usage 流末产出**：`parseSseLine` 识别 usage chunk（choices 空 + usage 字段）→ `extractUsage`；`stream` 收集 `lastUsage`，done 时随 chunk 产出——S5c 计量基线在 S5d 前有真实数据源。
2. **工具 schema 走 tools 参数**：`buildMessages` 只拼 system/history/workMemory；工具定义经 `LLMRequest.tools` → deepseek `toDeepSeekTool`（type:"function"），符合协议。`serializeToolDef` 保留为稳定序列化工具函数（缓存 key / S5d 工具描述）。
3. **三档价**：输入命中/未命中/输出分开计价（DeepSeek 真实 $0.07/$0.27/$1.10），避免两档把输出按输入价低估 ~61%。
4. **parameters 递归稳定排序**：`stableValue` 对象键字母序递归，保证工具 schema 字节级稳定（缓存前缀不因键序变化失效）。

---

## 四、审查标准

### 必须通过（已亲自验证，外部复核）

1. 三连全绿：`typecheck exit 0`（8 包）／`build exit 0`／`test 180/180`（21 文件）。
2. `parseSseLine` 识别 usage chunk；`stream` 结束 chunk 携带 usage。
3. `buildMessages` 无 tool 消息，顺序 system→history→workMemory。
4. `computeCost` 三档价（输出独立）；`serializeToolDef` parameters 键序不同输出一致；`computeHitRate` clamp [0,1]。

### 重点审查

- **P0 usage 时序**：usage chunk 在 [DONE] 前出现，`lastUsage` 正确收集并在 done 时产出；无 usage 时 done chunk 不带 usage。
- **P0 工具契约**：`buildMessages` 不再含 tool 消息；工具定义经 `LLMRequest.tools`（S5d 接入时传 tools 参数）。
- **P1 稳定序列化**：`stableValue` 对象键字母序；数组保序；空对象/嵌套递归正确。
- **P1 三档价换算**：`computeCost` 三档各自 /1e6；`Math.max(0, …)` 防负值。

### 已知限制（勿误报）

- `ChatMessage` 类型仍只有 role/content，缺 `tool_call_id`/`tool_calls`——S5d 实现工具调用往返前需扩展（审查 INFO，与 MAJOR-2 同源但属 S5d 范围）。
- `serializeToolDef` 当前无 stream 路径调用方，为稳定序列化工具函数（供缓存 key / S5d）；如审查视为死代码可后续接 S5d。
- usage 提取依赖 `stream_options.include_usage` 服务端支持；服务端忽略时 usage 缺失（done chunk 不带 usage，`extractUsage` 兜底 cachedTokens=0）。
- metrics `record` 全量读改写（O(n)，性能待 S5d 高频记录时优化）；config getter 无运行时类型校验（MINOR，自控存储低风险）。

---

**提交状态**：本轮改动独立提交：`fix(llm): 阶段32审查修复（usage 提取 / 工具走 tools / 三档价 / parameters 稳定排序）`。
