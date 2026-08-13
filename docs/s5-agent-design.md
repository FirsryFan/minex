# Minex S5 设计（LLM 接入 + Agent 通信）

> 总纲：**固定的是契约，自由的是内容；稳定的是基板，可变的是策略。**（设计思想继承自 `design-ideas.md` #11 无为而治）

## 决策清单

| # | 决策 |
|---|---|
| D1 | LLM Provider 抽象，DeepSeek 先行，其余一致 |
| D2 | MessageAssembler 分 S/W/P 三层，缓存与注意力解耦 |
| D3 | 协议信封独立于 session 图（session=用户知识体系，信封=agent 通信） |
| D4 | 信封：必填骨架固定 + 可选字段 + payload 自由（无顶层开放扩展） |
| D5 | 消息池：manager 独占写，expert 申请→批准→上传 |
| D6 | 代码插槽 = 受限 DSL + 白名单解释器，循环上限用户输入 |
| D7 | W 层排列优化 LLM 注意力，S 层严守缓存（append-only） |

---

## 二、LLM Provider（S5a）

```
LLMProvider.stream(request): AsyncIterable<chunk>
request = { model, messages, tools?, params, stream }
messages = { role, content }[]          // role: system/user/assistant/tool
chunk   = { delta, done }
```

- DeepSeek 实现内含：URL / 鉴权 / SSE 解析 / 缓存计费字段（`prompt_cache_hit_tokens`）。
- 后续 Claude/OpenAI/本地模型只换实现。
- `llm.config` 能力：模型列表、API key、默认参数（storage `minex.llm`）。

---

## 三、MessageAssembler（S5b）

三层消息模型：

| 层 | 内容 | 缓存前缀 | 谁能改 |
|---|---|---|---|
| S 稳定层 | system 骨架 + 完整对话历史（含**工具往返**：assistant tool_calls + tool 结果，按协议顺序 append） | ✅ 进 | 无人（append-only） |
| W 工作记忆层 | rework 的**提炼产物**（跨轮摘要/长期记忆，非协议必需） | ❌ 末尾 | 模型（经再加工 hook） |
| P 参数层 | temperature / reasoning_effort / thinking | ❌ 不在 messages | 模型自主 |

- **缓存纪律**：S 层字节级稳定（system 骨架固定、工具 schema 固定序列化、历史 append-only）。
- **注意力优化**（W 层）：相关性排序、结构化标记、精简、去噪。
- **再加工 hook**：默认透传工具结果（=L1，直接进 S 层历史）；L2 替换后产出**提炼进 W 层**，原始工具结果仍在 S 层（协议必需）。即 design-ideas #13 的「再加工步骤」。
- `MessageAssembler` 是唯一允许拼 messages 的地方。

---

## 四、协议信封（S5e）

```
Envelope {
  from: string          // 必填：发送方 agent id
  to: string | "*"      // 必填：接收方；"*" = 广播（消息池）
  type: string          // 必填：task / result / notice / pool-request / ...
  priority?: number     // 可选：优先级，默认 0
  deadline?: number     // 可选：时间预估/截止，默认 0
  deps?: string[]       // 可选：依赖的前序消息 id，默认 []（可并行）
  payload: unknown      // 内容 + 扩展的唯一自由载体
}
```

- 必填三字段 = 不可无为的最小约定（寻址 + 生命周期）；可选三字段有默认值（无效力）；payload 承载一切自由内容。
- `deps` 实现「时序 = 依赖声明，非到达顺序」，序号由调度器分配。
- 解析器：必填缺失报错；可选缺省取默认；payload 透传。

---

## 五、消息池（S5e）

复用内核 registry（黑板）+ events（失效通知），不新增原语。

- 存任务级共享信息（目标/约束/进度/结论），只存一份。
- manager 独占写；expert 发 `pool-request` → manager 批准 → 上传。
- manager 写后 `events.emit("pool:changed", { key })`，expert 感知更新。
- 只有高频共享进池，低频私有走 1v1 信封（局部性约束）。

---

## 六、调度器 execute（S5f）

> 执行顺序由「数据依赖」决定，非「声明顺序」；无依赖并行、有依赖串行。（CPU 乱序执行抽象）

```
Task { id, deps: string[], priority?, estimatedTime?, weight?, payload }
execute(tasks: Task[]): Promise<Result[]>   // 结果按原声明顺序回填
```

- 单 agent：tool_call = Task，execute 拓扑排序 + 并行，tool_result 按原顺序填回（缓存友好）。
- multiagent：子任务 = Task，manager 按依赖图分派 expert。
- 贪心启发式（管理时间短/重要性高/需求人数多/运行时间长）可插拔。

---

## 七、代码插槽（S5g）

模型生成声明式工作流数据（节点+转移+条件+依赖），固定解释器执行，能力面=白名单。

**允许**：callTool / readSession / writeSession / sendEnvelope / readPool / requestPoolWrite / branch / loop(上限用户输入) / localVar

**禁止**：eval / new Function / 动态 import / 直接网络 / 直接文件系统 / 宿主全局 / 内核越权 / 无界循环

白名单 = 操作注册表（可增删）。

---

## 八、落地顺序

S5a Provider → S5b Assembler → S5c 计量 → S5d agent loop → S5e 信封+消息池 → S5f 调度器 → S5g 插槽

> S5c 必须先于 S5d（否则无基线）。S5e 先信封后消息池。

---

## 九、待决

- Q9：调度器默认贪心权重（可先用「关键路径优先 + 优先级降序」）。
- Q10：execute 同批并行上限（需配置，防资源耗尽）。
