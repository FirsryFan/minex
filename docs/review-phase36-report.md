# Minex 阶段 36 审查报告（S5e：协议信封 + 消息池）

> 审查日期：2026-08-13　|　范围：`packages/agent-driver`（envelope.ts / pool.ts / index.ts）
> 对照：`docs/task-s5e.md` + `docs/s5-agent-design.md` 第四/五节 + `docs/report-36.md`

## 审查基线

三连本人实测（Windows Git Bash，cwd `E:/Minex`）：

**`npm run typecheck`** — exit 0（9 包）

```
> tsc --noEmit   (×9)
===TYPECHECK_EXIT:0===
```

**`npm run build`** — exit 0

```
> tsc (×8) + tsc --noEmit && vite build（ui-shell）
✓ built in 24.44s
===BUILD_EXIT:0===
```

**`npm test`** — exit 0（24 文件 / 202 测试全绿）

```
✓ packages/agent-driver/test/agent.test.ts   (11 tests)
✓ packages/agent-driver/test/envelope.test.ts (8 tests)
✓ packages/agent-driver/test/pool.test.ts     (3 tests)
 Test Files  24 passed (24)
      Tests  202 passed (202)
===TEST_EXIT:0===
```

三连结果与 report-36 声明一致（总量 202 正确）。

---

## 一、BLOCKER（必须修）

**无。**

信封/消息池为纯数据层，逻辑清晰。结构类型解耦已核实成立：`EnvelopeBus.emit/on` 与 `ctx.emit/on` 签名一致，`PoolStore.get/set` 与 `ctx.storage`（KVNamespace）结构子集兼容，`ctx` 可直接传入 `sendEnvelope/onEnvelope/createPool`（`index.ts:33-38`）。事件总线精确匹配（定向不串扰，测试已验证）。

---

## 二、MAJOR（建议修）

**无。**

---

## 三、MINOR / INFO（可留 / 观察）

### MINOR

1. **`onEnvelope(bus, "*", cb)` 重复订阅——广播消息回调触发两次**（`envelope.ts:68-75`）
   - **根因**：`onEnvelope` 同时订阅 `${ENVELOPE_PREFIX}:${to}` 与 `${ENVELOPE_PREFIX}:*`。当 `to === "*"` 时两者退化为同一 topic `agent:envelope:*`，`cb` 被注册两次。
   - **实测证据**：
     ```
     onEnvelope(bus, "*", cb); sendEnvelope(bus, {to:"*"})  =>  cb 触发 2 次（期望 1）
     onEnvelope(bus, "agentA", cb); sendEnvelope(bus, {to:"*"})  =>  cb 触发 1 次（正常）
     ```
   - **后果**：正常场景（`to` = 具体 agent id）不触发；仅当把 `to` 误传为 `"*"` 时广播被重复处理（重复执行副作用）。类型上 `to: string` 未约束，缺防御。
   - **修复方向**：`onEnvelope` 内对两个 topic 去重（`new Set([...])` 后各订阅一次）；或校验 `to !== "*"`（`onEnvelope` 语义是「订阅发往自身」，`to` 不应是广播目标）。

### INFO

1. **report-36 测试计数小误差**：文中「envelope 7 用例 + pool 3 用例」，实际 envelope 为 **8** 用例（parseEnvelope 4 + serializeEnvelope 1 + send/on 3）、pool 3 用例，合计 11（+agent 11 = 新增 22，总 202 正确）。分项计数少算 1，非代码缺陷。
2. **`parseEnvelope` 未校验 `from/to` 字符集**：`to` 直接拼 topic（`agent:envelope:<to>`）。当前事件总线为精确匹配（`to="a.b"` 与 `to="a"` 不串扰），但若未来 events 支持前缀/通配订阅，含 `:`/`.`/`*` 的 `to` 会串扰（历史教训 E1 的同类隐患）。建议约束字符集或转义。
3. **`Envelope.payload` 类型为必填 `unknown`，但 `parseEnvelope` 对缺失 payload 返回 `undefined`**：设计文档 payload 是「唯一自由载体」（非「必填三字段」），透传 `undefined` 合理，但类型标注与运行时行为有轻微不一致（类型精度）。
4. **`sendEnvelope` 直接 emit 对象引用，未走 serialize/parse**（`envelope.ts:62-65`）：进程内收发同一可变对象引用，接收方若修改会影响发送方；`parseEnvelope` 的必填校验在传输路径被旁路。serialize/parse 是为跨进程/持久化预留的纯函数（分层合理），但当前 send/on 路径无校验、无拷贝。
5. **`pool.write` 无「manager 独占写」的权限强制**：设计文档第五节「manager 独占写」，但 `createPool.write` 对任何持有 pool 引用的调用方开放，权限依赖编排层约定（manager/expert 角色待 S5f）。数据层无身份概念，属设计简化，接受。
6. **消息池落 agent 命名空间（非独立 `minex.pool`）**：report 已声明为已知限制——受限视图 `ctx.storage` 只能开自身 `manifest.id` 命名空间，任务清单「minex.pool」为概念名。实现用 `pool:` key 前缀在 agent 命名空间内隔离，且黑板「任务级共享」语义与「同一 manifest.id 多实例共享」一致，接受。
7. **`serializeEnvelope` 对 payload 含 `BigInt`/循环引用抛错；payload 为 `undefined` 时序列化省略该键**（JSON 固有限制），调用方需保证 payload 可序列化。

---

## 四、上一轮问题回归（review-phase34 → report-35 修复）

| review-phase34 问题 | 判定 | 验证 |
|---|---|---|
| MAJOR-1 S/W 层边界 | ✅ 决策 A 落实 | `s5-agent-design.md:40-46` 已更新：S 层 = 完整对话历史（含工具往返，按协议 append）；W 层 = rework 提炼产物；L2 提炼进 W 层、原始工具结果仍留 S 层 |
| MINOR-1 ttftMs 纯 tool_call 恒 0 | ✅ 已修 | `agent.ts:107` 改为 `first && (chunk.delta \|\| chunk.toolCallDelta)` |
| MINOR-2 空 id/name 回灌 `tool_call_id:""` | ✅ 已修 | `agent.ts:67` 加 `.filter(c => c.id !== "" && c.name !== "")` |
| MINOR-3 maxIterations≤0 | ✅ 已修 | `agent.ts:86` 改为 `Math.max(1, opts.maxIterations ?? 10)` |
| INFO-5 计量测试缺口 | ✅ 已修 | `agent.test.ts:116-135` 新增「计量集成」测试，断言 cost=1.29、hitRate=0.4（三档价） |

上一轮问题**全部真实修复**，report-35/36 的「无回归」声明属实。

---

## 五、验收逐条判定（对照 task-s5e.md）

| 条目 | 判定 | 说明 |
|---|---|---|
| 三连全绿 | ✅ | typecheck(9 包) / build / test(202) 实测 exit 0 |
| 1. 信封数据模型（parse/serialize 纯函数） | ✅ | 必填校验 / 默认值 / payload 透传 / deps 过滤非字符串 / 固定字段序 |
| 2. 信封传输（send/on 定向 + 广播） | ◐ | 定向/广播/退订正确，但 `onEnvelope(bus,"*",cb)` 重复订阅（MINOR-1） |
| 3. 消息池（read/write/onChanged） | ✅ | 写后读一致 + 失效通知 + 申请→批准→写闭环 + key 独立 |
| 4. 注册 envelope + pool 能力 | ✅ | `index.ts:30-38` 注册，结构类型解耦 |
| 5. 测试 | ✅ | envelope 8 + pool 3（report 计数少 1，INFO-1） |
| 验收：纯数据层两 agent 收发/池读写/通知/闭环 | ✅ | 测试覆盖 |

---

## 六、结论与修复优先级

本轮 S5e **无 BLOCKER、无 MAJOR**，信封与消息池为纯数据层，逻辑正确、三连全绿、结构类型解耦成立、上一轮问题全部真实修复。仅 1 处 MINOR（`onEnvelope(bus,"*",cb)` 重复订阅）+ 若干 INFO。

**修复优先级：**

1. **MINOR-1（onEnvelope `*` 重复订阅）** —— 唯一建议修的，一行去重即可（`new Set` 去 topic 或校验 `to !== "*"`），顺手补一个 `onEnvelope(bus,"*",cb)` 的测试用例防回归。
2. INFO-2/4/7（`to` 字符集校验、send 旁路 serialize、payload 可序列化约束）—— 若后续引入「跨进程信封」或「events 前缀订阅」，需一并处理；当前进程内纯数据层可留。
3. INFO-5（manager 独占写权限）、INFO-6（pool 命名空间）—— 属 S5f 调度器/编排层的设计范畴，留待后续。
