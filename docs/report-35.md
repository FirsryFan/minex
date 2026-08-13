# Minex 阶段报告 35（2026-08-13）—— 阶段 34 审查修复（S/W 层边界决策 + 3 MINOR + 计量测试）

> 报告制度（固定四节）。本轮内容：执行 `review-phase34-report.md`——MAJOR-1（S/W 层边界，经 designer 决策 A）+ MINOR-1/2/3 + INFO-5（计量测试缺口）。
> 前置：`docs/report-34.md` → `docs/review-phase34-report.md`。

---

## 一、上次问题回归（review-phase34）

| 项 | 决策 | 处理 |
|---|---|---|
| **MAJOR-1** S/W 层边界 | designer 决策 **A**：工具往返历史归 S 层 | 代码无需改（S5d 已回灌 history=S 层）；designer 已更新 `s5-agent-design.md` 第三节措辞 |
| **MINOR-1** ttftMs 纯 tool_call 恒 0 | — | 首分片判定纳入 `toolCallDelta`（`chunk.delta || chunk.toolCallDelta`） |
| **MINOR-2** 空 id/name 防御 | — | `parseAssistantResponse` 重组后过滤空 id/name（避免 API 400） |
| **MINOR-3** maxIterations≤0 防呆 | — | `Math.max(1, opts.maxIterations ?? 10)` |
| **INFO-5** 计量测试缺口 | — | 加 `recordMetrics` 断言（cost/hitRate 值正确） |

---

## 二、本轮目标与内容

| # | 内容 | 定位 |
|---|---|---|
| 1 | MAJOR-1 决策落实 | designer 决策 A（工具历史归 S 层），文档更新，代码不动 |
| 2 | MINOR-1 ttftMs | `agent.ts` 首分片判定 |
| 3 | MINOR-2 空 id 过滤 | `parseAssistantResponse` filter |
| 4 | MINOR-3 maxIterations | `Math.max(1, …)` |
| 5 | INFO-5 计量测试 | `agent.test.ts` 加计量断言 |

---

## 三、具体实现

### 关键代码定位（file:line，供审查对照）

| 改动点 | 定位 |
|---|---|
| ttftMs 首分片判定 | `agent-driver/src/agent.ts:112-115` |
| 空 id/name 过滤 | `agent-driver/src/agent.ts:67-71` |
| maxIterations 防呆 | `agent-driver/src/agent.ts:95` |
| 计量测试断言 | `agent-driver/test/agent.test.ts:110-130` |
| S/W 边界文档 | `docs/s5-agent-design.md:38-46`（designer 更新） |

### 关键设计

1. **S/W 边界定案（决策 A）**：工具往返历史（assistant tool_calls + tool 结果）属 S 层 append-only（ReAct 协议要求 tool 结果紧跟 assistant）；W 层只承载 rework 的提炼产物（跨轮摘要/长期记忆）。`rework` 默认透传进 S 层历史，L2 替换后产出提炼进 W 层。
2. **ttftMs 修正**：首个分片（文本或工具调用）即计首 token 延迟，纯 tool_call 流不再漏计。
3. **防御**：空 id/name 分片重组视为异常丢弃；maxIterations≤0 至少 1 次迭代。

---

## 四、审查标准

### 必须通过（已亲自验证，外部复核）

1. 三连全绿：`typecheck exit 0`（9 包）／`build exit 0`／`test 191/191`（22 文件）。
2. 计量：stream 结束 `recordMetrics` 被调用，cost/hitRate 值正确（测试断言）。
3. 纯 tool_call 流 ttftMs 非 0；空 id/name 工具调用被过滤；maxIterations=0 至少 1 次迭代。

### 重点审查

- **P0 计量断言**：cost 三档价计算、hitRate = cached/prompt 正确。
- **P1 防御**：过滤空 id/name 不产生 `tool_call_id:""` 回灌。

### 已知限制 / 待办（勿误报）

- INFO-1（typecheck 依赖 dist）—— 既有全局模式（kernel 同），排入后续「构建基建」专项。
- INFO-2（assistant tool_calls 时 content 空字符串 vs null）—— 待实测确认服务端接受。
- INFO-3（rework 返回非 tool 消息破坏协议）—— hook 契约责任，L2 替换时保证合法。
- INFO-6（stream 中途 break 未 cancel reader）—— 沿用 S5a，流式 API 通用边界。

---

**提交状态**：本轮改动独立提交：`fix(agent): 阶段34审查修复（S/W 边界决策 + ttftMs/空id/maxIterations 防呆 + 计量测试）`。
