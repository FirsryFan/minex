# Minex 阶段 1 内核代码审查报告

> 审查日期：2026-08-12　|　范围：`packages/kernel/src/*.ts`（9 文件）+ `packages/kernel/test/*.ts`（4 文件）
> 所有结论均经运行时实测验证（构建产物 + 临时验证脚本），非纯静态推断。

## 审查基线

- `npm run typecheck` ✅ 通过
- `npm run build` ✅ 通过
- `npm test` ✅ 19/19 全绿

---

## BLOCKER（必须修）

### B1 — 激活失败后副作用残留，状态不一致，且无回收路径
`packages/kernel/src/lifecycle.ts:49-73`

**实测**：`activate` 中途抛异常 → 状态停在 `discovered`，但插件此前 `ctx.register("tool","leak",42)` 已写入 registry、`ctx.on()` 已订阅事件，全部泄漏且**永远无法清理**：
- `deactivate` 要求 `state === "activated"`（`lifecycle.ts:77`），直接 return，不会触发 `onDeactivated`。
- `unregister` 只删 `records`（`lifecycle.ts:97`），不清理 registry。

**根因**：`activate` 非原子。副作用（register/on）与状态提交（`r.state = "activated"`）之间没有回滚路径。

**建议**：`catch` 块内调用回滚——`opts.onDeactivated?.(pluginId)`（内核侧即 `registry.unregisterByPlugin`），或引入 `"failed"` 中间态让失败可被显式回收。对应简报 P0「异步激活异常」与风险点 4，实际严重度比预期更高。

### B2 — 同优先级冲突是「后注册者覆盖」，与契约「先到者胜」矛盾
`packages/kernel/src/registry.ts:54`、`packages/kernel/src/types.ts:71`、`packages/kernel/test/registry.test.ts:11`

**实测**：`register` 两次同 `type+id`、同 `priority` → 最终值为后注册者 `"second"`。

**矛盾点**：`if (existing && priority < existing.priority) return` 只在严格小于时拒绝；相等则覆盖。接口注释与 `PluginContext.register` 注释（`types.ts:71`）均声明「同优先级先到者胜」。

**需决策**：改代码（`<=` 拒绝）还是改文档。当前 `registry.test.ts:11` 的断言只验证了**不同 id 的排序稳定**，未覆盖同 id 同优先级冲突——缺口直接掩盖了矛盾。

---

## MAJOR（建议修）

### M1 — `destroy()` 一个插件 cleanup 失败，后续插件被跳过
`packages/kernel/src/kernel.ts:95-101`

**实测**：插件 `bad` 的 cleanup 抛异常 → `await` 中断循环 → `good` 状态停留在 `activated`，资源未回收。

**建议**：逐插件 try/catch 记录失败继续下一个（或 `Promise.allSettled` 风格）。对应简报风险点 5，**属实**。

### M2 — `reloadable` 字段声明但从未实现，API 语义误导
`packages/kernel/src/types.ts:19-20`

`reloadable` 在全部源码中仅出现一次（声明处），lifecycle 从不读取。`deactivated` 插件 `activate` 恒抛 `register it again to reload`（`lifecycle.ts:53`），即 `reloadable: true` 也无法热重载。要么实现（重建 ctx 重新激活），要么移除字段/改注释，当前是死代码 + 契约矛盾。

### M3 — `compareVersions` 非数字段静默判等
`packages/kernel/src/version.ts:2-13`

**实测**：`compareVersions("1.0.abc", "1.0.0") === 0`——含 NaN 的段与任何数比较均为 false，循环静默走到相等。`"1.2-beta"` 经 `parseInt("2-beta")` 被当成 `2`，与 `"1.2.0"` 判等。`minKernelVersion` 校验（`lifecycle.ts:40`）可能误判。对应风险点 2，**属实**。建议：非数字段定义明确语义（字符串比较 / 视作 0 / 抛错），或引入正式 semver 解析。

### M4 — JSON 文件存储非原子写
`packages/kernel/src/storage.ts:61-65`

`writeFileSync` 直接覆盖目标文件。单进程常规关闭安全（同步写完才返回），但 kill -9/断电窗口会写坏 JSON，且下次 `load` 的 `catch` 会把损坏文件当空文件并覆盖，数据静默丢失。建议：写临时文件 + `fs.renameSync` 原子替换，成本极低。

### M5 — 依赖激活失败导致部分激活，无回滚
`packages/kernel/src/lifecycle.ts:61-65`

**实测**：`A` 依赖 `dep-ok`、`dep-bad`，后者激活抛错 → `dep-ok` 已处于 `activated`，`A` 停在 `discovered`。若宿主期望「全激活或全不激活」事务语义，需在依赖激活失败时回滚已激活依赖。

### M6 — 并发 `activate` 同一插件被误报为「环」
`packages/kernel/src/lifecycle.ts:55-57`

**实测**：`Promise.all([activate("c"), activate("c")])` → 一个成功，另一个抛 `Circular dependency detected`。根因：`activating` 集合同时承担「进行中标记」与「环检测」，二者语义混淆。建议：用 in-flight Promise 去重（第二次调用复用同一 Promise），环检测改用独立调用栈/路径标记。

---

## MINOR（可留）

- **m1** `query`/`get` 返回内部对象引用（浅拷贝）：数组是副本，但元素 `Contribution` 是共享引用，调用者改 `c.priority` 会污染内部 store（`registry.ts:81-84`）。
- **m2** `priority` 为 NaN/Infinity 无防护：NaN 与任何数比较为 false，会无脑覆盖，且破坏 `query` 排序（`registry.ts:53-55`）。负数无问题。
- **m3** namespace 名 sanitize 非单射：`"a/b"` 与 `"a_b"` 映射到同一文件，持久数据互相覆盖。v1 插件 id 含点号合法不受影响，但建议「拒绝非法字符」而非替换。
- **m4** 空 `type`/`id`/`topic`/namespace 无输入校验，功能正常但防呆缺失。
- **m5** `events.ts:16`、`registry.ts:44` 中 handler 抛异常会中断其余 handler 分发，一个坏插件可阻断整条链路。
- **m6** `events`/`registry` 的 Map 在退订后保留空 Set，动态 topic 场景内存膨胀。
- **m7** `activate` 进行中（await 间隙）`unregister` 竞争：records 已删但 activate 继续跑完，`getState` 返回 undefined 而插件实际激活。
- **m8** `set(k, undefined)` 与 delete 效果混淆（`list()` 仍含 k 但持久化丢弃该键）；循环引用对象 `JSON.stringify` 抛 TypeError，无防护。
- **m9** 每次 `set` 全量写文件，高频写性能差。

---

## INFO（观察）

- 所有 `as unknown as` 强转均有据可依（`registry.ts:81/84`、`storage.ts:17/20`）：值类型由调用方保证，属必要逃生舱。
- 停用后插件存储数据保留 = 持久化设计决策，正确。
- `ctx.on` 退订依赖插件在 cleanup 里主动调用，内核不代管——插件责任，文档应强调。
- `deactivate` 不按依赖逆序：v1 无运行时依赖保证，可接受。
- `destroy()` 幂等（二次调用无副作用），已验证。
- `query` 排序稳定（V8 稳定排序）：「先注册者先」在排序层成立，矛盾仅在冲突覆盖语义（见 B2）。

---

## 已知风险点逐条判定

| # | 风险点 | 判定 | 定级 |
|---|--------|------|------|
| 1 | `storage.ts` persist 非原子写 | **属实**，单进程常规影响低，崩溃窗口存在 | MAJOR（M4） |
| 2 | `version.ts` NaN 段 | **属实**，语义错误 | MAJOR（M3） |
| 3 | registry 无 size 上限 | 属实，但属 v1 全信任设计范畴（简报已排除沙箱） | 接受 |
| 4 | activate 抛异常后状态 | **属实，比预期严重**：停在 `discovered` + 副作用残留无回收路径 | BLOCKER（B1） |
| 5 | destroy 部分失败跳过后续 | **属实** | MAJOR（M1） |

---

## 测试缺口（重点，投入产出比最高）

- **lifecycle**：环检测、activate 抛异常、cleanup 抛异常、destroy 部分失败、deactivate 幂等、并发 activate、deactivated 后 re-activate、依赖失败部分激活——**全无测试**。其中 B1、M1、M5、M6 均因此漏检。
- **registry**：同优先级冲突（掩盖 B2）、`unregisterByPlugin` 的 onChange 通知、空 type、NaN/负 priority——无测试。
- **storage**：`createJsonFileStorage`（生产默认实现）**完全无测试**，3 个用例全用内存实现。m3/m4/m8 均无覆盖。
- **events**：显式 `off`、handler 抛异常、同 handler 重复订阅——无测试。

---

## 结论与修复优先级

架构判断：微内核四原语 + 双视图分离清晰，`PluginContext` 受限视图落地正确，正常路径测试覆盖尚可。**但失败路径近乎零测试，而全部 BLOCKER/MAJOR 都在失败路径上**。建议修复顺序：

1. **B1** 激活失败回滚（生命周期正确性核心）
2. **M1** destroy 逐插件容错
3. **B2** 决策冲突语义并补测试
4. 补失败路径测试（`activate`/`cleanup`/`destroy` 各注入一次异常）
5. **M3/M4** 顺手修（各约 5 行）
