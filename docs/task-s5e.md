# 任务清单 · S5e（协议信封 + 消息池，合并）

> 依据 `s5-agent-design.md`（第四/五节）。合并理由：信封是消息池的传输层，消息池是信封的应用（pool-request/pool-grant 就是信封类型），两者密不可分。
> 前置：无需等 S5d——本阶段是纯数据层 + 能力，不依赖 agent loop，可与 S5d 并行。
> 验证三连：`npm run typecheck && npm run build && npm test`。

## 1. 信封数据模型（纯函数，src/envelope.ts）
- `Envelope = { from: string; to: string | "*"; type: string; priority?: number; deadline?: number; deps?: string[]; payload: unknown }`
- `parseEnvelope(raw: unknown): Envelope` —— 必填 `from/to/type` 缺失抛错；可选字段取默认（priority=0 / deadline=0 / deps=[]）；payload 原样透传。
- `serializeEnvelope(env: Envelope): string` —— 固定字段序 JSON（from→to→type→priority→deadline→deps→payload）。

## 2. 信封传输（events 定向 + 广播，src/envelope.ts）
- `sendEnvelope(events, env)` —— `to === "*"` 广播到 `agent:envelope:*`；否则定向到 `agent:envelope:<to>`。
- `onEnvelope(events, to, cb)` —— 订阅自身（含 `*` 广播）的信封，回调收解析后的 Envelope。

## 3. 消息池（registry 黑板 + events 失效通知，src/pool.ts）
- 注册 `pool` 能力：`read(key): unknown` / `write(key, value)`（manager 独占，写后 `events.emit("pool:changed", { key })`）/ `onChanged(cb)`。
- 存储落在 storage 命名空间 `minex.pool`（key/value 映射）。
- expert 写流程：`sendEnvelope`（type=`pool-request`）→ manager 收后回 `pool-grant` → expert 调 `write`。

## 4. 注册（src/index.ts）
- 在 agent-driver（或独立 comm-driver，programmer 自定）注册 `envelope` 能力（parse/serialize/send/on）+ `pool` 能力。

## 5. 测试（test/envelope.test.ts / test/pool.test.ts）
- `parseEnvelope`：必填缺失抛错 / 可选默认 / payload 透传（任意类型）。
- `serializeEnvelope`：字段序固定（两次调用字节一致）。
- `sendEnvelope`/`onEnvelope`：定向只送达目标、`*` 送达全体。
- `pool`：写后读一致 / `onChanged` 收到失效通知 / expert 申请→批准→写流程（mock manager）。

## 验收
- 三连全绿。
- 纯数据层验证：两 agent 间收发信封（定向 + 广播）、消息池读写 + 失效通知、申请→批准→写闭环。
