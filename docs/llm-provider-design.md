# LLM Provider 接入层设计（S5 · DeepSeek 先行）

> 版本：v0.1（2026-08-13）　|　前置：内核四原语 + 驱动机制 + session 数据层（S1/S2）已就绪
> 目标：设计一个**可插拔、可观测、可调优**的 LLM 接入层，DeepSeek 先行、其余 provider 一致；为后续 harness 开源后的「全面微调」预留灵活点。

---

## 一、优化方向全景（回答「除了缓存命中率还有什么」）

LLM 接入层的优化分 **成本** 与 **体验** 两条线，缓存命中率只是成本线里最重要的一条。全景如下：

### 成本线（花多少钱）
1. **上下文缓存命中率**（核心，本设计重点）——输入 token 里「稳定前缀」占比越高，命中越便宜。
2. **Token 总量 / 上下文压缩**——历史过长时摘要/截断/滑窗，减少每次请求的输入 token。
3. **工具 schema 精简**——工具定义的 token 占比往往很大，精简描述、只保留必要参数、参数名取短。
4. **模型路由（routing）**——简单任务走便宜快模型，复杂任务才走强模型；多级路由省大钱。
5. **上下文注入策略（RAG/context engineering）**——只注入相关片段，不塞无关内容。

### 体验线（好不好用）
6. **流式输出 + 首 token 延迟（TTFT）**——先吐字、边生成边渲染，用户感知远好于等全量。
7. **结构化输出（JSON mode / tool use）**——减少「输出格式不对 → 重试」的浪费。
8. **重试 / 降级 / fallback**——超时重试、主 provider 挂了切备胎，可靠性。

### 元层面（让优化可持续）
9. **可观测性 / 计量**——token 用量、缓存命中率、延迟、成本分项统计。**没有计量就无法优化**；harness 上线后要靠它做 A/B 对比。
10. **推理参数按任务调优**——temperature / max_tokens / top_p 等，不是全局一刀切。

> 结论：缓存命中率是「性价比最高」的一项，但**它不是孤立的**——压缩、路由、结构化输出都会间接影响缓存（压缩改变前缀、路由换模型缓存失效）。所以设计上必须把它们放在同一套「请求组装 + 计量」框架里协同，而非各做各的。

---

## 二、缓存命中率的原理与提升手段（深入）

### 原理
DeepSeek 的 context caching 是**自动前缀缓存**：请求的 messages 前缀若与历史请求**字节级一致**，命中部分按低价计费（deepseek-chat 命中约 $0.1/M，未命中 $2/M，价差 20 倍）。Claude 是显式 `cache_control` 断点（有 5min TTL），OpenAI 是自动前缀缓存。**共同点：前缀必须稳定。**

### 提升命中率的关键手段（接入层能做的全部）
1. **稳定前缀排序**：`system → 工具定义 → 早期历史 → 最新用户输入`。变动的放最后，稳定的放最前。
2. **system prompt 恒定**：不内插时间戳、随机数、会话 id、动态状态。需要动态的部分放最后一条消息或单独字段。
3. **工具定义字节级稳定**：JSON 序列化时**固定字段顺序 + 固定缩进**，不要用「对象属性顺序由运行时决定」的序列化；工具列表不因「本次没用到的工具」而增删（要么全量稳定，要么按固定顺序裁剪）。
4. **历史只追加、不重写**：多轮对话里，早期消息一旦写入就**永不修改、永不重排、永不中间插入**。任何「润色早期消息」「重新排序上下文」都会使前缀失效。
5. **压缩/摘要的落点**：上下文压缩要「**替换掉靠后的历史**」或「把摘要放到前缀末尾」，**不能改前缀开头**。否则压缩一次缓存全失效。
6. **并发复用**：多 agent / 多请求共享同一前缀时，命中率随请求数放大——路由与批处理要尽量让「同一 system+tools 的请求」聚在一起。

---

## 三、架构设计（对齐 Minex 微内核 + 驱动）

### 总体：LLM 是一个「驱动」，注册「能力」，复用 session
```
llm-driver（新包）
  ├─ 注册 "llm" 能力：LLMProvider 抽象（chat / stream / 计量）
  ├─ 注册 "llm.config" 能力：模型列表 + API key + 路由规则（存 storage）
  └─ （后续）注册 "agent" 能力：agent loop 消费 llm + session + filesystem
```

### 3.1 Provider 抽象（统一接口，DeepSeek 先行）
一个 `LLMProvider` 接口，屏蔽各家 API 差异，只暴露：
- `stream(request): AsyncIterable<chunk>`（统一流式，DeepSeek/OpenAI/Anthropic 都是流式）
- `request` 结构：`messages` + `tools` + `model` + `params` + `stream` 标记
- **provider 差异全部关在实现里**（URL、鉴权头、SSE 解析、缓存计费字段），上层（agent）无感。

这样「其他 provider 一致」成立：接 Claude/OpenAI/本地模型只换实现，不动 agent 层。

### 3.2 请求组装层（缓存优化的落点，核心）
独立的 `MessageAssembler`，职责是把「会话 + 工具 + 系统提示」组装成 `messages`，**并保证稳定前缀**：

- 输入：`systemPrompt`（固定）、`tools`（固定 schema 序列化）、`session`（历史节点）
- 输出：`messages`（system → tools → history → 最新输入）
- **它是唯一允许触碰「消息顺序/内容」的地方**——agent 层不直接拼 messages，避免破坏缓存。

**关键约束（写进接口契约）**：
- system prompt 与工具定义的序列化在**一次会话内字节级不变**；
- 历史消息 append-only，早期消息不可变；
- 压缩/摘要产生的变更只发生在「历史尾部」，不触碰前缀。

### 3.3 会话历史来源（复用 S1/S2 的 session 数据层）
对话历史直接复用 `session` 的节点图：
- `kind: "user" | "assistant" | "tool"` 的 nodes 就是 history；
- `links.type: "responds"` 给主链排序（非线性分支留给画布）；
- 多实例隔离（doc/会话按实例）已在 S4 规划，llm 层直接继承，不重复造。

这样「会话」与「LLM 调用」解耦：agent loop 只往 session 加节点，MessageAssembler 从 session 取历史组装——历史持久化、非线性、多 agent 溯源都在 S1/S2 已铺好。

### 3.4 可观测性 / 计量（优化的前提）
`LLMMetrics` 记录每次请求：
- `promptTokens` / `completionTokens` / `cachedTokens`（缓存命中 token）
- `ttft`（首 token 延迟）/ `totalMs`
- `cost`（按 provider 价格表算，含命中/未命中价差）
- `model` / `provider` / `hitRate`（按会话/工具前缀维度聚合）

**落点**：storage（会话级）或独立 metrics 能力。没有它，harness 上线后的「微调」就是拍脑袋。

### 3.5 策略可插拔（为后续优化预留的灵活点）
以下全部做成**独立模块 + 接口**，harness 开源后可以逐项替换/增强而不动主体：
- **缓存策略**：当前是「稳定前缀」，harness 可能带来更激进的 prompt 结构/缓存断点技巧 → 换 `CacheStrategy`。
- **压缩策略**：摘要 vs 滑窗 vs 语义压缩 → 换 `CompactionStrategy`。
- **路由策略**：规则路由 vs 基于成本/质量动态路由 → 换 `Router`。
- **工具裁剪策略**：全量 vs 按相关性裁剪 → 换 `ToolSelector`。
- **重试/降级**：超时、限流、provider fallback → 换 `RetryPolicy`。

---

## 四、实践流程（分阶段，每阶段可验证）

| 阶段 | 内容 | 验收 |
|---|---|---|
| **S5a** | llm-driver 骨架 + DeepSeek `LLMProvider`（chat + stream）+ config 存储 | CLI 能发一条消息、流式返回 |
| **S5b** | `MessageAssembler`（system+tools+history，稳定前缀）+ 复用 session 历史 | 多轮对话，前缀稳定 |
| **S5c** | `LLMMetrics`（token/缓存命中/延迟/成本）+ 打印报告 | 能看到命中率与成本 |
| **S5d** | agent 驱动雏形（agent loop：查工具→调用→回灌 session），复用 Ch5 工具调用模式 | 能跑通一个带工具的任务 |
| **S5e** | 压缩/路由（先做最简单的滑窗压缩 + 规则路由） | 长对话不爆窗、简单任务省成本 |
| **后续** | harness 开源 → 对照 metrics 做 A/B，逐项替换 CacheStrategy/CompactionStrategy | 命中率/成本指标提升 |

> 关键：**S5c（计量）必须在 S5d（agent）之前**——否则 agent 跑起来后优化没有基线，harness 对比也无从谈起。

---

## 五、为后续「微调与提升」预留的灵活点（harness 开源后）

1. **一切优化都收敛为「策略接口」**：缓存、压缩、路由、工具裁剪、重试都做成可替换模块。harness 的优化点落到哪个策略，就只改哪个模块，主体（provider 抽象 / 会话 / agent loop）不动。
2. **计量先行**：harness 上线前先把 metrics 基线建好（当前 DeepSeek 命中率、成本、TTFT），开源后能做**同输入同输出的 A/B 对比**，量化「学到的优化」值多少。
3. **provider 与 prompt 结构解耦**：harness 可能针对 DeepSeek 优化 system prompt 结构、工具格式、缓存断点——这些都属于「MessageAssembler / CacheStrategy」层，不碰 provider 实现。
4. **会话历史是唯一事实源**：优化围绕「如何把 session 高效地变成 messages」展开，而非在 agent 里硬拼消息——这样 harness 的任何历史处理技巧都能复用同一份 session 数据。

---

## 六、结论

- 缓存命中率是性价比最高的优化，但必须放在「稳定前缀 + 计量 + 可插拔策略」的框架里，与压缩/路由/工具裁剪协同，否则各优化互相打架（压缩毁前缀、路由换模型毁缓存）。
- 架构上：**LLM 是驱动，能力是 `LLMProvider`，请求组装是独立层，会话历史复用 S1/S2，计量先行**。这四件事做好，DeepSeek 先行、其他 provider 一致、harness 开源后微调，就都只是「换策略模块」而非「推倒重来」。
