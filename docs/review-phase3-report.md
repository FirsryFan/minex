# Minex 阶段 3 内核代码审查报告

> 审查日期：2026-08-12　|　范围：`packages/cli/**`（阶段 3 新代码）+ 内核 v0.2.1 修改点
> 对照简报：`docs/report-03.md`。所有结论均经运行时实测（构建产物 + 真实 CLI 进程 + 专项脚本）。

## 审查基线

- `npm run typecheck` ✅ `npm run build` ✅（kernel + demo + cli 三包）
- `npm test` ✅ **63/63** 全绿（8 文件：lifecycle 16 / registry 10 / loader 8 / manifest 6 / storage 6 / events 6 / version 3 / cli 6）
- 端到端冒烟 ✅：`minex run demo.sayHello Minex` → `Hello, Minex!`；`plugins list` / `config set/get` 全通；`run 不存在` → 友好报错 + 退出码 1
- 版本一致性 ✅：kernel 0.2.1、demo/CLI 均声明 `^0.2.1`（简报额外发现 1 已修复）
- `.minex-data/` 已 gitignore（第 152 行）✅

---

## 一、上一轮修复回归验证（v0.2.1）

| 上一轮项 | 修复方式 | 本轮判定 |
|---|---|---|
| L1 静态贡献失败泄漏 | loader catch 内 `unregisterByPlugin` + failed 汇报 | ✅ 有效（测试 "L1: entry without activate…"；pluginId 先 name 后 manifest.id，parse 失败时静态未注册无需清，逻辑正确） |
| L2 静态贡献 reload 存活 | `Contribution.origin` + onDeactivated 只清 runtime | ⚠️ 纯静态场景有效；**「静态→运行时升级」路径 origin 被覆盖**（本轮 C2） |
| L3 深层依赖回滚 | 激活 session 整树逆序回滚 | ✅ 有效（测试 "L3: deep dependency failure…"，`lifecycle.ts:270-289`；session 只在激活成功时 add） |
| L4 loadFromDir 幂等 | isRegistered + alreadyRegistered | ✅ 有效（测试 "L4: second loadFromDir…"） |
| L5 全错中止 → 逐个容错 | failed 数组 | ✅ 有效（测试 "per-plugin fault tolerance…"） |
| m1 同插件降级放行 | `!samePlugin` 才拒绝低优先级 | ✅ 有效 |
| m2 compareVersions 严格十进制 | `NUMERIC=/^\d+$/` | ✅ 有效（version.test.ts 3 用例） |
| m3 目录排序确定性 | `names.sort()` | ✅ 有效 |
| m4 manifest id 收紧 | `isValidId` 分段校验 | ✅ 有效（拒绝 `..`/`-x`/尾点） |
| m7 plugins:sync 前置构建 | 脚本链 build | ✅ 有效 |
| m8 JSON 语法错误测试 | loader 测试 | ✅ 有效 |

**上一轮全部问题已修复**，且版本失配（demo 依赖 404）已通过统一 `^0.2.1` 消除。本轮无 BLOCKER。

---

## 二、MAJOR（建议修）

### C1 — `main()` 激活循环无容错，一个插件激活失败中止整批（CLI 全不可用）
`packages/cli/src/main.ts:33-35`

```ts
const { manifests, failed } = await kernel.plugins.loadFromDir(pluginsDir);
for (const m of manifests) await kernel.plugins.activate(m.id);   // ← 无 try/catch
```

**实测**：注册 `bad`（activate 抛 "boom"）+ `good` → 模拟 main 的循环 → `bad` 抛错中止，`good` 停在 `discovered`（被跳过）。

**问题**：`loadFromDir` 已做到逐个容错（failed 汇报），但激活循环没有对齐——任一插件 activate 抛错，整个 CLI 命令失败（连 `config get` / `plugins list` 这类只读命令也失败），且无友好汇报（只有 stack trace 冒泡）。简报 P0 关注「config 命令不需要激活却激活了」——副作用本身是设计权衡，**激活失败不隔离**才是缺陷。

**建议**：激活循环逐个 try/catch，失败汇入 `failed`（或单独 `activateFailed[]`）打印后继续；只读命令（config/plugins list）应容忍插件激活失败。

### C2 — 静态贡献被 activate 重注册后 origin 升级为 runtime，deactivate 时静态声明丢失
`packages/kernel/src/registry.ts:79`（重注册覆盖 origin）+ `kernel.ts:95`（只清 runtime）

**实测**：command 静态声明（origin `static`）→ activate 重注册同 id（origin 变 `runtime`）→ `deactivate` → `registry.get("command","c.hello")` **GONE**（静态 label 也被清）。

**根因**：单一 key + `origin` 标记无法表达「静态层 + 运行时层叠加」。demo 插件的 command 走「静态 label → 运行时 handler」升级路径，重注册把整条贡献的 origin 覆盖为 runtime，deactivate 时按 runtime 清空，静态声明随之消失。

**影响**：deactivated 暂态下 UI 读不到静态声明的 label（「激活前可见、存活到卸载」的设计意图部分失效）；reload 后 activate 重建可恢复，但 deactivated 窗口丢失。L2 测试只覆盖「纯静态贡献」（activate 不重注册），未覆盖该升级路径。

**建议**：重注册时保留原 origin（同 key 更新 value 不换来源），或静态/运行时分两层存储、deactivate 只揭掉运行时层露出静态层。

---

## 三、MINOR（可留）

- **C3** CLI 错误路径输出不友好：`plugins activate <不存在>` → `Unknown plugin` stack trace；`config get <非法namespace>` → `Storage: invalid namespace` stack；`run` handler 抛错冒泡 stack。行为符合 CLI 预期（错误可见 + 非零退出），建议 `main` 顶层统一 try/catch 转友好消息。对应简报 P1「handler 抛错是否符合预期」——判定：**可接受但建议改进**。
- **C4** `pluginsCmd` 对不存在插件执行 activate/deactivate/reload → 抛错冒泡，无友好提示（同上，可合并处理）。
- **C5** `cli.ts` 顶层 `process.exit(await main(...))`：main 抛错时走 unhandled rejection 退出（非零码 + stack），无显式退出码控制。可接受。

---

## 四、INFO（观察）

- **C6** `config set` JSON 宽松解析（实测）：`"null"`→`null`、`"123"`→`123`、`"hello"`→字符串。**符合简报「尽力 JSON」设计决策**。
- **C7** `runCommand` handler 类型 `(...args: string[]) => unknown` 与 demo `(name?: string) => string` 兼容（argv 本质是字符串数组）。
- **C8** CLI 宿主边界合规：只读 `registry`/`storage`/`plugins` 宿主视图，未绕开 `PluginContext`，未 import 内核内部模块。✓
- **C9** `main` 的 `finally destroy` 可靠：dispatch 抛错时 destroy 仍执行（kernel destroy 自身逐插件容错），退出路径无资源泄漏。
- **C10** `reload` 从未激活插件 → 正常激活（实测），边界合理。
- **C11** `config set` 当次激活不生效：冒烟复现（config set 前激活读旧值 `你好`，set 后新进程读 `Hi`）。简报已知限制，**接受**。
- **C12** 每次 CLI 进程均 loadFromDir + 激活全部（含只读命令）：副作用 + 启动开销，与 C1 相关，属设计权衡。

---

## 五、简报重点问题判定

| 简报问题 | 判定 |
|---|---|
| P0 启动激活全部插件的副作用 | 属实（只读命令也激活），设计权衡；**激活失败不隔离中止整批**是真缺陷（C1） |
| P0 run 对 handler 类型假设 | 兼容（argv 字符串数组） |
| P0 finally destroy 可靠性 | 可靠（kernel destroy 容错，dispatch 抛错仍执行） |
| P0 CLI 与内核边界 | 合规（只读宿主视图，不碰 PluginContext） |
| P1 loadFromDir 失败汇报 | 清晰（failed 含 id + error） |
| P1 handler 抛错捕获 | 未捕获冒泡 → 非零退出，符合预期但无友好消息（C3） |
| P1 config JSON 宽松性 | 符合「尽力 JSON」设计决策（C6） |

---

## 六、已知限制判定

1. config set 当次激活不生效 → 属实，冒烟复现，接受（v1）。
2. CLI 无参数校验库 → 属实，命令数少时足够。
3. `.minex-data/` 已 gitignore → 属实（.gitignore:152）。

---

## 七、测试缺口

- **main.test.ts（6 用例）只测三个命令函数**，未测 `main()` 装配全链路：loadFromDir → 激活全部 → dispatch → finally destroy、**激活失败中止（C1）**、未知命令、`plugins activate/deactivate/reload` 分支、`config set` 非法 JSON。C1 因 main() 未测而漏检。
- **origin 覆盖升级路径（C2）**：loader/lifecycle 无测试（"L2: pure static…" 只覆盖纯静态场景）。
- **CLI 错误路径（C3/C4）**：无测试。

---

## 八、结论与修复优先级

阶段 3 的 CLI 设计（命令=注册表贡献、依赖注入可测、JSON 尽力解析）自洽，端到端冒烟全通，上一轮全部修复有效，**本轮无 BLOCKER**。两个 MAJOR 均在「失败隔离」与「来源追踪」两个既有主题上：

1. **C1** 激活循环逐个容错（与 loadFromDir 对齐）——CLI 可靠性核心，约 5 行。
2. **C2** 静态/运行时分层或保留 origin——补上 origin 机制的升级路径，修复「静态 label 丢失」。
3. 补 `main()` 装配测试 + 激活失败用例（投入产出比最高，C1/C2 均由此漏检）。

后续建议：CLI 顶层统一错误捕获（C3/C4/C5 合并），输出用户可读错误而非 stack trace。
