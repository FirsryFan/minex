# Minex 阶段报告 32（2026-08-13）—— S5a-c：LLM 接入层（Provider 抽象 / DeepSeek / Assembler / Metrics）

> 报告制度（固定四节）。本轮内容：按 `docs/task-s5a-c.md` 完成 S5a（llm-driver Provider 抽象 + DeepSeek）、S5b（MessageAssembler S/W/P 三层）、S5c（LLMMetrics 计量）。
> 前置：`docs/report-31.md` → 依据 `docs/s5-agent-design.md` 落地顺序 S5a→S5b→S5c。

---

## 一、上次问题回归

- report-31（多实例隔离）无遗留 BLOCKER/MAJOR（第 5 步 reload 占用为待办）。
- 回归面：三连保持全绿（本轮实测 21 文件 / 176 测试）。

---

## 二、本轮目标与内容

| # | 内容 | 定位 |
|---|---|---|
| S5a-1 | 建包 | `packages/llm-driver/`（package/tsconfig/manifest，纯 TS 无 jsx）；根脚本纳入 |
| S5a-2 | 类型 | `types.ts`：ChatMessage/ToolDef/LLMRequest/LLMChunk/LLMUsage/LLMProvider |
| S5a-3 | DeepSeek | `deepseek.ts`：stream + parseSseLine + extractUsage 纯函数 |
| S5a-4 | config + 注册 | `index.ts`：llm.config + llm 能力（动态读 key，无 key 抛错） |
| S5b | Assembler | `assembler.ts`：serializeToolDef + buildMessages（S/W 分层）+ assembleWorkMemory |
| S5c | Metrics | `metrics.ts`：computeCost + computeHitRate；index.ts 注册 llm.metrics |

---

## 三、具体实现

### 文件清单与联系

| 文件 | 职责 |
|---|---|
| `llm-driver/src/types.ts` | LLM 公共类型（Provider 抽象契约） |
| `llm-driver/src/deepseek.ts` | DeepSeek 实现：fetch + SSE 解析；`parseSseLine`/`extractUsage` 纯函数 |
| `llm-driver/src/assembler.ts` | S/W 三层消息装配：`serializeToolDef`（字节级稳定）+ `buildMessages` + `assembleWorkMemory` |
| `llm-driver/src/metrics.ts` | `computeCost`/`computeHitRate` 纯函数 + 类型 |
| `llm-driver/src/index.ts` | 注册 `llm.config`（含价格表）/`llm`/`llm.metrics` |
| `llm-driver/test/{deepseek,assembler,metrics}.test.ts` | 21 用例 |
| `package.json` | build/typecheck 纳入 minex-llm-driver |

### 关键代码定位（file:line，供审查对照）

| 改动点 | 定位 |
|---|---|
| parseSseLine / extractUsage | `llm-driver/src/deepseek.ts:10-32` |
| DeepSeek stream（SSE 流式） | `llm-driver/src/deepseek.ts:41-92` |
| serializeToolDef / buildMessages | `llm-driver/src/assembler.ts:14-47` |
| assembleWorkMemory（透传） | `llm-driver/src/assembler.ts:55-61` |
| computeCost / computeHitRate | `llm-driver/src/metrics.ts:27-44` |
| config / llm / metrics 注册 | `llm-driver/src/index.ts:28-79` |

### 关键设计

1. **Provider 抽象**：`LLMProvider.stream` 返回 `AsyncIterable<LLMChunk>`；DeepSeek 先行，后续 Claude/OpenAI 只换实现。
2. **SSE 纯函数**：`parseSseLine`（data 行 / [DONE] / 非法）与 `extractUsage`（缓存计费字段）独立可测，不含 I/O。
3. **S/W/P 分层**：`buildMessages` 顺序 system → tool（序列化 schema）→ history → workMemory；S 层字节级稳定（`serializeToolDef` 固定字段序），W 层末尾动态（`assembleWorkMemory` 默认透传）。
4. **动态 key**：`llm` 能力的 stream 每次读 config key（后配置 key 也生效），无 key 抛「未配置 API key」。
5. **计量**：`computeCost` 命中×hit + 未命中×miss（每 1M token 美元）；`computeHitRate = cached/prompt`；价格表按模型由 config 提供（不写死）。

---

## 四、审查标准

### 必须通过（已亲自验证，外部复核）

1. 三连全绿：`typecheck exit 0`（**8 包**，含 llm-driver）／`build exit 0`／`test 176/176`（21 文件，新增 21 用例）。
2. `parseSseLine` 处理 delta 行 / [DONE] / 空行 / 非 JSON / 无 content。
3. `extractUsage` 提取缓存命中字段；缺省 cached=0。
4. `serializeToolDef` 两次输出字节级一致；字段序 name→description→parameters。
5. `buildMessages` 顺序 system→tool→history→workMemory；`computeCost` 全命中/全未命中/混合；`computeHitRate` 0/50%/100%/prompt=0。

### 重点审查

- **P0 SSE 流式**：fetch body 读取、跨行 buffer 处理、[DONE] 结束、错误状态抛错。
- **P0 工具序列化**：DeepSeek tools 格式（type:"function" 包装）与 ToolDef 映射。
- **P1 S 层稳定**：serializeToolDef 固定字段序保证缓存前缀稳定；buildMessages 不重排 history。
- **P1 计量精度**：computeCost 的 hit/miss 划分（miss = prompt - cached + completion）；价格换算（/1e6）。

### 已知限制（勿误报）

- `LLMChunk` 不含 usage；`extractUsage` 为纯函数（供 S5d agent loop 组合），当前 stream 不做 usage 追踪。
- 价格表默认空（不写死），未配置价格时 computeCost 调用方需自备 prices。
- 无 CLI 冒烟测试（可选验收，需真实 API key）。
- `assembleWorkMemory` 默认透传（=L1）；L2 再加工 hook 待 S5d 替换。

---

**提交状态**：本轮改动独立提交：`feat(llm): S5a-c LLM 接入层（Provider 抽象 + DeepSeek + Assembler + Metrics）`。
