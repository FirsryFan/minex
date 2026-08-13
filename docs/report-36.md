# Minex 阶段报告 36（2026-08-13）—— S5e：协议信封 + 消息池

> 报告制度（固定四节）。本轮内容：按 `docs/task-s5e.md` 完成协议信封（Envelope 数据模型 + 定向/广播传输）与消息池（registry 黑板 + 失效通知），均为纯数据层 + 能力。
> 前置：`docs/report-35.md` → `docs/task-s5e.md`。

---

## 一、上次问题回归

- review-phase34 的 MAJOR-1（S/W 边界，决策 A）+ MINOR + 计量测试已在 report-35 修复，本轮无回归。
- 回归面：三连保持全绿（本轮实测 24 文件 / 202 测试）。

---

## 二、本轮目标与内容

| # | 内容 | 定位 |
|---|---|---|
| 1 | 信封数据模型 | `envelope.ts`：Envelope 类型 + parseEnvelope/serializeEnvelope 纯函数 |
| 2 | 信封传输 | `sendEnvelope`（定向/广播）+ `onEnvelope`（订阅自身 + 广播） |
| 3 | 消息池 | `pool.ts`：createPool（read/write/onChanged，存储 + 失效通知） |
| 4 | 注册 | `index.ts` 注册 `envelope` + `pool` 能力 |
| 5 | 测试 | envelope 7 用例 + pool 3 用例 |

---

## 三、具体实现

### 文件清单与联系

| 文件 | 职责 |
|---|---|
| `agent-driver/src/envelope.ts` | Envelope 类型 + parseEnvelope/serializeEnvelope（纯函数）+ sendEnvelope/onEnvelope（传输） |
| `agent-driver/src/pool.ts` | createPool（key/value 存 storage + `pool:changed` 失效通知） |
| `agent-driver/src/index.ts` | 注册 `envelope` + `pool` 能力 |
| `agent-driver/test/envelope.test.ts` + pool.test.ts | 10 用例 |

### 关键代码定位（file:line，供审查对照）

| 改动点 | 定位 |
|---|---|
| Envelope 类型 | `agent-driver/src/envelope.ts:8-16` |
| parseEnvelope（必填校验 + 默认） | `agent-driver/src/envelope.ts:29-49` |
| serializeEnvelope（固定字段序） | `agent-driver/src/envelope.ts:52-62` |
| sendEnvelope（定向/广播） | `agent-driver/src/envelope.ts:65-68` |
| onEnvelope（订阅 + 退订） | `agent-driver/src/envelope.ts:71-78` |
| createPool（read/write/onChanged） | `agent-driver/src/pool.ts:29-44` |
| envelope/pool 注册 | `agent-driver/src/index.ts:26-37` |

### 数据流

```
信封：sendEnvelope(bus, env)
  to === "*" → emit agent:envelope:*（广播）
  否则      → emit agent:envelope:<to>（定向）
  onEnvelope(bus, to, cb) 订阅 agent:envelope:<to> + agent:envelope:*

消息池：pool.write(key, value) → storage.set(pool:key) + emit pool:changed { key }
  expert 写流程：sendEnvelope(pool-request) → manager 回 pool-grant → expert pool.write
```

### 关键设计

1. **必填三字段 = 最小约定**：from/to/type 缺一抛错；priority/deadline/deps 有默认（无效力）；payload 唯一自由载体（原样透传）。
2. **定向 + 广播两级**：`to === "*"` 广播到 `agent:envelope:*`；否则定向 `agent:envelope:<to>`；onEnvelope 同时订阅自身定向 + 广播。
3. **消息池复用内核原语**：storage（黑板）+ events（失效通知），不新增内核机制；manager 独占写、expert 申请→批准→写。
4. **结构类型解耦**：EnvelopeBus/PoolStore/PoolBus 最小接口，ctx（emit/on/storage）与 createEventBus 均兼容。

---

## 四、审查标准

### 必须通过（已亲自验证，外部复核）

1. 三连全绿：`typecheck exit 0`（9 包）／`build exit 0`／`test 202/202`（24 文件，新增 envelope 7 + pool 3）。
2. `parseEnvelope`：必填缺失抛错 / 可选默认 / payload 透传 / deps 过滤非字符串。
3. `serializeEnvelope`：字段序固定（两次字节一致）。
4. `sendEnvelope`/`onEnvelope`：定向只送达目标、`*` 送达全体、退订后不再收到。
5. `pool`：写后读一致 + onChanged 通知 + 申请→批准→写闭环 + key 独立。

### 重点审查

- **P0 信封寻址**：定向/广播 topic 正确；onEnvelope 同时订阅自身 + 广播（不遗漏）。
- **P0 消息池一致性**：write 后 read 一致；onChanged 失效通知；key 前缀 `pool:` 隔离。
- **P1 结构类型**：EnvelopeBus/PoolStore 最小接口，ctx 兼容。

### 已知限制（勿误报）

- 信封的 `deps`（依赖声明）字段已建模，但「时序 = 依赖声明」的调度排序由 S5f 调度器实现（当前仅存储）。
- 消息池存 agent-driver 命名空间（key 前缀 `pool:`），非独立 `minex.pool` 命名空间——受限视图 ctx.storage 无法开任意命名空间（任务清单「minex.pool」为概念名，实现落 agent 命名空间）。
- `onEnvelope` 回调收到原始 Envelope（未再 parse，已由 send 时构造）；若外部经 emit 直接发原始 JSON，需调用方 parse。
- 信封/消息池为纯数据层，无 UI；多 agent 实际编排（manager/expert 角色）待 S5f 调度器 + 后续 agent 编排。

---

**提交状态**：本轮改动独立提交：`feat(agent): S5e 协议信封 + 消息池`。
