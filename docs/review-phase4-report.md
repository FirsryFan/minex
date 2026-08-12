# Minex 阶段 4 代码审查报告（UI 壳 v0.4.0）

> 审查日期：2026-08-12　|　范围：`packages/ui-shell/**`（阶段 4）+ 内核 v0.2.2（registry 分层）+ CLI v0.2.2 修复
> 对照方案/报告：`docs/report-04.md`（方案）、`docs/report-05.md`（实施报告）。
> 说明：环境无浏览器工具，无法真实跑 `npm run ui` 验收；运行时断言用 Node 脚本模拟 bootstrap 内核交互验证，vite 构建已验证可打包。

## 审查基线

- `npm run typecheck` ✅ `npm run build` ✅（四包全绿，ui-shell vite build 56 模块 / 160KB）
- `npm test` ✅ **66/66** 全绿（8 文件：cli 8 / loader 9 / lifecycle 16 / registry 10 / manifest 6 / storage 6 / events 6 / version 3）
- 版本一致性 ✅：kernel 0.2.2、ui-shell 依赖 `^0.2.2`
- stub 覆盖完整 ✅：node:fs/path/url → 浏览器 stub，vite build 通过证明无遗漏

---

## 一、上一轮修复回归验证

| 上一轮项 | 修复方式 | 本轮判定 |
|---|---|---|
| C1 激活循环容错 | main.ts:37-45 逐 try/catch + failed | ✅ 有效（测试覆盖） |
| C2 静态 label 被覆盖 | **registry 分层**（static/runtime 两层，effective=runtime??static） | ✅ 有效（实测：deactivate 后 command label 存活、handler 消失、ui 静态存活） |
| C3 CLI 顶层捕获 | main.ts:59-62 → `错误: <msg>` | ✅ 有效 |

**C2 分层是本轮核心改动，实测确认设计意图达成**：停用后「label 可见、handler 消失」天然成立，demo 的 ui 静态贡献跨 reload 存活。报告 04 选择分层而非「保留 origin」的决策正确。

---

## 二、MAJOR（建议修）

### U1 — 验收标准 3 与实现矛盾：UI 用内存存储，页面刷新设置必丢
`packages/ui-shell/src/bootstrap.tsx:17`（`createKernel({ storage: createInMemoryStorage() })`）

report-05 验收标准 3：「设置改 greeting → 保存 → **刷新后数据在**」。**实测**：保存到内存存储 → 新内核（模拟页面刷新）→ `config` **丢失**。内存存储无法跨页面刷新持久，且 UI 无 reload 插件功能——「刷新」在 Web 语境只能指页面刷新，而页面刷新必丢。

**建议**：二选一——(a) 给 `StorageProvider` 加浏览器 localStorage 适配器（约 20 行，`namespace` 映射到 `localStorage` key）；(b) 修改验收标准为「reload 插件后数据在」（但当前 UI 没有 reload 入口，需补）。

### U2 — bootstrap 静态贡献泄漏：registerStatic 成功、register 失败不回滚
`packages/ui-shell/src/bootstrap.tsx:22-38`

`registerStaticContributions` → `register` → `activate` 包在同一 try/catch。**实测**：清单含重复 id 时 `register` 抛 `Plugin already registered` → 已注册的静态贡献 `dup-ui` **LEAKED**（catch 只 push problems，未 `unregisterByPlugin`）。

**与第一轮 L1 完全同构**（loader 已修 catch 回滚，bootstrap 未对齐）。当前显式清单 v1 单插件不触发，但清单一旦误加重复 id 即泄漏且无恢复入口。

**建议**：catch 内 `kernel.registry.unregisterByPlugin(p.manifest.id)` 回滚静态贡献。

---

## 三、MINOR（可留）

- **U3** SettingsForm `plugin!` 裸断言崩溃（`SettingsForm.tsx:22`）：`useState` initializer 在 `if (!plugin)` 检查**之前**访问 `plugin!.manifest.id`。实测：无 settingsSchema 插件时 TypeError，React 组件崩溃。report-05 已知限制 2 已声明依赖「有 schema 的插件已加载」，但崩溃未兜底。建议：initializer 用可选链，`plugin` undefined 时返回空表。
- **U4** StrictMode 双 effect 竞态（`main.tsx` `<StrictMode>` + `bootstrap.tsx:43-46`）：dev 下 effect 挂载两次，第一次内核的异步激活循环与 cleanup 的 `destroy()` 竞态——destroy 后循环继续激活的插件不会被停用（孤儿内核，dev-only + 可 GC）。建议循环内 `cancelled` 检查。
- **U5** registry 跨层优先级失效（`registry.ts:48-49`）：实测 `static(A,p10)` + `runtime(B,p0)` → effective = runtime(B)。**低优先级 runtime 遮蔽高优先级 static**（不同插件）。effective=runtime??static 的固有语义，v1 单插件无碍，多插件时需注意跨层优先级不可比。
- **U6** `unregister(type,id)` 删两层（`registry.ts:100-106`）：实测 unregister 后 static+runtime 都删。插件 `ctx.unregister` 会连自己的静态声明一起删，与「静态存活到卸载」意图相悖。
- **U7** 换肤不彻底（`index.css:107,204`）：两处硬编码 `#fff`（主色按钮文字）、`rgba(15,23,42,0.45)`（浮窗遮罩），改 `--color-primary` 时这两处不跟随。换肤架构本身成立（结构全 var()）。
- **U8** SettingsForm number 输入无校验：空输入 `Number("")` = 0 静默写入。
- **U9** 浮窗无 Esc 关闭 / focus 管理（体验）。

---

## 四、INFO（观察）

- C2 分层修复有效（本轮最重要的正向验证）。
- stub 方案完整：浏览器路径永不触达 fs（vite build 通过，`createKernel` 传内存存储绕过 `createJsonFileStorage` 默认路径）。
- 内核边界合规：UI 只读宿主视图 + `registerStaticContributions` 经公共入口导入，未 import 内核内部模块。✓ 报告标准 5 满足。
- 事件刷新：App `useEffect` 订阅 `onChange("*")` + `minex:dataChanged`，cleanup 统一退订，无泄漏；topic 与 SettingsForm 保存一致；重渲染风暴风险低（bootstrap 激活在 App 挂载前完成，运行期事件频率低）。
- RightBar handler 无参调用与 demo `(name?: string)` 兼容；handler 抛错被捕获转 `错误:` 消息（好于 CLI）。
- 未知 location 的 ui 贡献被 filter 忽略（不报错），合理。
- demo 源码经 Vite 直接加载（type-only import 编译消除），浏览器模块图干净。

---

## 五、简报重点问题判定

| 简报问题 | 判定 |
|---|---|
| P0 bootstrap 插件加载失败隔离 | 激活逐插件容错 ✓；**registerStatic→register 失败不回滚**（U2） |
| P0 槽位 location 约定 | 未知 location 忽略（filter），合理 |
| P1 SettingsForm schema 覆盖面 | string/number/boolean ✓；**plugin! 崩溃风险**（U3）；非法值无校验（U8） |
| P1 事件刷新订阅清理 | 无泄漏 ✓；topic 一致 ✓；风暴风险低 ✓ |
| P1 内核边界 | 合规 ✓（只读宿主视图 + 公共入口） |
| 验收标准 1/2/4 | 可满足（构建 + 布局 + 命令 + 换肤） |
| 验收标准 3（刷新持久） | **与实现矛盾**（U1） |

---

## 六、测试缺口

- ui-shell **无自动化测试**（report-05 已知限制）：U1/U2/U3 均由此漏检。至少应补 bootstrap 单测（静态贡献回滚、激活容错）+ SettingsForm 的 plugin 空值路径。
- registry 分层：跨层优先级（U5）、`unregister` 删两层（U6）无测试。
- loader C2 测试已覆盖「纯静态升级路径」，但未覆盖「跨层不同插件」冲突。

---

## 七、结论与修复优先级

阶段 4 UI 壳整体成立：分层布局 + 换肤令牌 + 事件刷新 + 内核边界全部干净，vite 可打包，C2 分层修复是设计正确性的亮点。**无 BLOCKER**。两个 MAJOR 都在「持久化」与「失败回滚」两个既有主题上：

1. **U1** 验收标准 3 矛盾（内存存储 vs 刷新持久）——需决策 localStorage 适配器或改标准。
2. **U2** bootstrap 静态贡献回滚（与 L1 同构，补 `unregisterByPlugin` 一行对齐 loader）。
3. 补 ui-shell bootstrap 单测（U1/U2/U3 的漏检根源）。
4. U3/U5/U6 顺手修（各数行）。

项目四阶段（内核 → 目录加载 → CLI → UI 壳）已闭环，**同一内核跑通 CLI 与 UI 两个宿主**，领域无关性验收达成。下一里程碑（图形画布）可在此骨架上前进。
