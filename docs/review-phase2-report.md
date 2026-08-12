# Minex 阶段 2 内核代码审查报告

> 审查日期：2026-08-12　|　范围：`packages/kernel/src/*.ts`（11 文件）+ `test/*.ts`（6 文件）+ `packages/demo-plugin` + `scripts/sync-plugins.mjs`
> 对照简报：`docs/report-02.md`。所有结论均经运行时实测（构建产物 + 临时验证脚本）。

## 审查基线

- `npm run typecheck` ✅ `npm run build` ✅（kernel + demo-plugin）
- `npm test` ✅ **48/48** 全绿（lifecycle 15 / registry 10 / loader 5 / manifest 6 / storage 6 / events 6）
- 冒烟：`plugins:sync` → `loadFromDir('./plugins')` → `activate('minex.demo')` → command/tool/ui **三通道全通**

---

## 一、第一轮修复的回归验证

| 上一轮项 | 修复方式 | 本轮判定 |
|---|---|---|
| B1 激活失败回滚 | dispose 先存 + onDeactivated + failed 态可重试 | ✅ 有效（测试覆盖）；但暴露**深层依赖回滚残留**（本轮 L3） |
| B2 同优先级先到者胜 | registry 区分插件归属 | ✅ 有效；但**同插件低优先级重注册被拒**，与「重注册=更新」契约矛盾（本轮 m1） |
| M1 destroy 容错 | 逐插件 try/catch | ✅ 有效（测试覆盖） |
| M2 reload | reload 方法 + reloadable:false 拒绝 | ✅ 有效（测试覆盖）；但暴露**静态贡献 reload 后丢失**（本轮 L2） |
| M3 compareVersions NaN | 非数字段字符串比较 | ✅ 有效（逻辑验证）；`Number()` 仍接受 0x/科学计数（m2） |
| M4 JSON 原子写 | tmp + renameSync | ✅ 有效（标准原子替换） |
| M5 依赖失败部分激活 | 逆序停用新激活依赖 | ✅ 直接层有效；**传递层残留**（本轮 L3） |
| M6 并发 activate 误报环 | in-flight Promise 去重 + 调用链分离 | ✅ 有效（测试覆盖） |

**修复质量总体良好**，上一轮全部 BLOCKER/MAJOR 均有对应修复与测试。但本轮新代码（loader / 静态贡献 / reload）引入 4 个新问题，其中 2 个与第一轮 B1 同构（失败路径泄漏）。

---

## 二、BLOCKER（必须修）

### L1 — `loadFromDir` 失败路径泄漏静态贡献，且无恢复入口
`packages/kernel/src/loader.ts:41` vs `:44-56`

**实测**：目录 `leak.demo`（合法 manifest + `contributes.ui` + entry 无 activate）→ `loadFromDir` 抛「must export an activate function」，但：
- `ui/leak-ui` 静态贡献**已残留在 registry**（registerStaticContributions 在 import 检查之前执行）；
- 该插件**没有 lifecycle record**（register 未执行）→ `onDeactivated` 永不触发 → 经 `kernel.plugins.*` 无法回收，只能绕过 lifecycle 直接 `registry.unregisterByPlugin`。

**与第一轮 B1 完全同构**：失败发生在「副作用已产生」与「状态提交」之间。B1 修了 activate 的失败回滚，但 loader 的失败路径没有等价回滚。

**建议**：对失败插件 `try { ... } catch { host 回滚其静态贡献 }`（catch 内 `unregisterByPlugin(manifest.id)`），或先收集所有插件再统一注册（提交点后移）。

### L2 — 静态贡献在 reload / deactivate 后永久丢失
`packages/kernel/src/kernel.ts:93-95`（unregisterByPlugin 全清）与 `loader.ts:66-77`（静态贡献一次性注册）

**实测**：demo-plugin 的 `ui/demo-panel`（纯静态声明，activate 不重注册）→ `reload("minex.demo")` 后 `registry.get("ui","demo-panel")` 返回 **undefined**。command 因 activate 显式重注册而恢复，**纯静态贡献不恢复**。

**根因**：deactivate → `onDeactivated` → `unregisterByPlugin` **无差别清空**该插件全部贡献（静态 + 运行时），而静态贡献只在 `loadFromDir` 注册一次。这同时违背「静态贡献激活前即可用」的设计意图——deactivated 插件静态贡献也丢了。

**建议**：静态贡献与运行时贡献分离生命周期。最小改法：`Contribution` 增加 `origin: "static" | "runtime"`，`onDeactivated` 只清 runtime；或 `activate` 时重放 `manifest.contributes`。

---

## 三、MAJOR（建议修）

### L3 — 深层依赖失败时，间接依赖残留为孤儿激活
`packages/kernel/src/lifecycle.ts:68-76, 85-91`

**实测**：`A → B → D`，D 激活成功、B 激活成功、A 激活失败 → 回滚后：`A=failed, B=deactivated, D=activated`。**D 残留激活**。

**根因**：`depsActivated` 是 `doActivate` 的局部变量，只覆盖「本次调用直接激活的依赖」。B 成功时其 `depsActivated`（含 D）已丢弃；A 失败回滚 B 时，只停用 B 本身，B 当初新激活的 D 信息已丢失，无法传递回收。

**建议**：将「本次激活新增依赖」信息提升到调用链级（顶层 catch 逆序回滚完整闭包），或 `deactivate` 递归停用其本次新激活的依赖。

### L4 — `loadFromDir` 非幂等且全错中止
`packages/kernel/src/loader.ts:59` + `lifecycle.ts:155-158`

**实测**：第二次 `loadFromDir('./plugins')` → 第一个插件即抛 `Plugin already registered: minex.demo`，**目录内其余插件全部跳过**。宿主无法「增量扫描新插件」或「重扫目录」。

**判定**：简报 P0 待决策项——**缺陷**，不是预期。非幂等 + 单点中止两个问题叠加。

**建议**：对已注册插件**跳过并汇报**（LoadResult 增加 `alreadyRegistered`），失败插件也跳过而非中止（见 L1/L5 决策）。

### L5 — 中途失败语义：前 N-1 个不回滚（简报 P1 待决策）
`packages/kernel/src/loader.ts:26-63`

目录按序扫描，第 N 个失败 → 前 N-1 个已注册插件保持注册状态，但调用方收到 reject。状态是「部分成功」而非「全部失败」，且失败插件的静态贡献泄漏（L1）。

**建议**：改为**逐个容错，失败跳过并汇报**（`LoadResult` 增加 `failed: { id, error }[]`），比当前「抛错中止」对宿主更友好，同时天然解决 L1/L4。

---

## 四、MINOR（可留）

- **m1** 同插件低优先级重注册被拒，与「重注册=更新」契约矛盾（`registry.ts:66`）：`priority < existing.priority` 的拒绝不分插件归属。插件无法把自己的贡献优先级从 5 降到 0。影响 demo 正常路径（静态 0 → 运行时 0 相等成立）不触发。
- **m2** `version.ts` 用 `Number()` 解析段：`Number("0x10")=16`、`Number("1e3")=1000`、`Number(" ") = 0`，比 `parseInt` 更宽松。建议正则严格解析纯十进制。
- **m3** `loadFromDir` 目录枚举顺序非确定（`readdirSync` 无顺序保证）：两个插件静态注册同 type+id 同 priority 时「先到者胜」的胜负取决于 FS 枚举顺序（实测 winner 不稳定）。建议 `readdirSync` 后按名字排序，加载确定性。
- **m4** `parseManifest` id 正则 `^[A-Za-z0-9._-]+$` 允许 `".."`、`"-x"`、`"a."` 尾点、连续点。建议收紧（不允许首尾分隔符/连续点）。
- **m5** `registerStaticContributions` 对 contributes 内部形状静默跳过（非数组 / 无 id / 非对象 item），与 manifest.ts 顶层严格校验风格不一致。宽容可接受，但错误静默。
- **m6** JSON 存储 tmp 文件在 `renameSync` 失败时残留（目标被占用等异常路径），下次覆盖。影响小。
- **m7** `sync-plugins.mjs` 只拷贝 dist，不触发构建——改了 demo 源码忘记 build 就 sync，产物过期。建议脚本内加 `npm run build -w minex-demo-plugin` 前置。
- **m8** manifest.json **JSON 语法错误**路径无测试（`JSON.parse` 抛 SyntaxError 冒泡，行为正确但未覆盖）。
- **m9** reload 正在激活中的插件：`reload` 先置 `state="discovered"` 再 `activate`，若该插件已有 in-flight 激活，可能重复执行 activate 副作用。边缘时序。

---

## 五、INFO（观察）

- 冒烟测试三通道（command / tool / ui）全通，`minKernelVersion: "0.1.1"` 与 `MINEX_KERNEL_VERSION="0.1.1"` 匹配，`loadFromDir` 入口检查通过。
- entry 路径解析正确：相对路径 `path.resolve(pluginDir, entry)`、绝对路径覆盖、Windows `pathToFileURL`（本机 win32 实测通过）。entry 指向目录或缺失文件会抛 import 错误冒泡，行为合理（全信任模型下 entry 越界 `../` 不设防，属已知 v1 决策）。
- import 缓存：重复 `loadFromDir` 会重新 `import` 同一 URL（Node ESM 缓存命中），activate 函数不变——与「软重载」限制一致，简报已列为已知。
- `command {id,label,handler}` shape 留在 demo 插件内、未进内核 types.ts：**符合内核领域无关约束**，建议在项目文档中固化为共享约定（UI 宿主与各插件共同遵守）。
- `events.ts` / `registry.ts` 的 `safeCall` 用 `console.error` 而非注入 logger——文件保持领域无关（不依赖内核 logger），但错误被吞后调用方无感知。
- `manifest.id` 与插件目录名可脱节（loader 用目录名定位、用 manifest.id 注册），无强制一致校验。

---

## 六、简报重点问题判定

| 简报问题 | 判定 |
|---|---|
| P0 重复 loadFromDir 会重复注册？ | **缺陷**（L4）：抛错中止，非幂等 |
| P0 entry 路径解析 | 正确（相对/绝对/Windows 实测通过）；越界 entry 属 v1 全信任决策 |
| P0 import 缓存 / reload 不重 import | 属实，已知限制（软重载），接受 |
| P0 manifest 校验完整度 / id 正则 | 必填+类型校验完整；id 正则可收紧（m4） |
| P1 中途失败是否应逐个容错 | **建议改为逐个容错**（L5），顺带解决 L1 泄漏 |
| P1 command shape 是否进内核类型 | 建议留在领域（内核领域无关），固化为共享约定文档 |

---

## 七、已知限制判定

1. reload 软重载（不重 import）→ **属实，已知限制，接受**。
2. loadFromDir 中途失败不回滚 → **属实，且比简报预期更严重**：不只是「前 N-1 不回滚」，失败插件静态贡献泄漏且无恢复入口（L1）。
3. 静态贡献只注册描述符、handler 靠 activate 补 → **属实，但引出 L2**：纯静态贡献（ui）在 reload 后不恢复。

---

## 八、测试缺口

- **loader**：重复 loadFromDir（L4）、entry 失败静态贡献残留（L1）、目录名 ≠ manifest.id、manifest.json JSON 语法错误、静态贡献 reload 存活（L2）、目录枚举顺序确定性（m3）——均无测试。
- **lifecycle**：深层依赖回滚（L3）、reload 失败插件 / 未激活插件、reload 进行中并发——无测试。
- **registry**：同插件低优先级重注册被拒（m1）、静态 vs 运行时贡献区分——无测试。
- **manifest**：id 边界（`".."`、`"-x"`、尾点）、contributes 内部非法形状——无测试。
- **storage**：tmp 残留路径、rename 失败路径——无测试（主路径已覆盖）。

---

## 九、结论与修复优先级

架构上阶段 2 的「目录加载 → 静态贡献 → 声明式/命令式混合」设计是自洽的，demo 冒烟全通，上一轮修复全部有效。**本轮 4 个新问题集中在「失败路径」与「静态贡献生命周期」两处**：

1. **L1** 静态贡献失败泄漏（BLOCKER，与 B1 同构）——loader 失败回滚
2. **L2** 静态贡献 reload 丢失（BLOCKER）——静态/运行时贡献分离生命周期
3. **L3** 深层依赖回滚残留（MAJOR）——depsActivated 提升到调用链级
4. **L4+L5** loadFromDir 非幂等 + 全错中止（MAJOR）——改为逐个容错 + 汇报，一并解决

建议：L1/L2 属「失败路径 + 生命周期」组合，与第一轮 B1 修复共享模式（副作用提交前回滚 / 贡献来源追踪），投入产出比最高。L3 独立于 loader，可在 lifecycle 内修。L4/L5 是 loader 行为决策，建议定「逐个容错」语义后统一实现。
