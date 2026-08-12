# Minex 阶段报告 04（2026-08-12）

> 报告制度（固定四节）：① 上次审查修改结果 + 代码定位 + 额外发现 ② 本轮目标与预期功能 ③ 具体实现 ④ 审查标准。
> 上一轮审查：`docs/report-03.md`（简报）→ `docs/review-phase3-report.md`（报告）。

---

## 一、上次审查问题的修改结果（v0.2.2）

阶段 3 报告无 BLOCKER，2 个 MAJOR + 3 个 MINOR，全部修复。

| # | 问题 | 修复方式 | 代码定位 | 验证 |
|---|---|---|---|---|
| C1 | main 激活循环无容错，一个失败中止整批 | 激活循环逐个 try/catch，失败汇入 `failed` 汇报，只读命令不受影响 | `packages/cli/src/main.ts:28-38` | `test/main.test.ts` "C1: main survives…" |
| C2 | 静态贡献被 activate 重注册后 origin 升级，deactivate 时静态 label 丢失 | **registry 改分层存储**：每个 (type,id) 有 static/runtime 两层，`effective = runtime ?? static`；停用只揭掉 runtime 层露出静态层 | `packages/kernel/src/registry.ts` 全文件 | `test/loader.test.ts` "C2: static label survives…" |
| C3/C4/C5 | CLI 错误路径输出 stack trace | main 顶层统一 try/catch → `错误: <message>`，返回 1 | `packages/cli/src/main.ts:42-47` | `test/main.test.ts` "C3: main catches…" |

**选择分层的理由**（比「保留 origin」更正确）：命令的 label 是静态（声明）、handler 是运行时（activate 提供）。保留 origin 会让 handler 随停用残留（可调用）——错误；分层让「停用后 label 可见、handler 消失」天然成立。

### 额外的发现

1. **分层存储解决了 L2 的根因而非症状**：纯静态贡献（ui）与「静态 label → 运行时 handler 升级」共用同一机制，不再需要 demo 侧特判。
2. **版本一致性**：`^0.2.1` 的 caret 范围自动匹配 0.2.2，无 404 回归。

### 测试

63 → **66**（8 文件）：registry 分层后既有测试全通过（默认 origin=runtime 语义不变）+ 新增 C2 升级路径 / C1 main 容错 / C3 友好错误。

---

## 二、本轮目标与预期功能（阶段 4：UI 壳，方案待审）

> ⚠️ 本报告 ②③④ 为**待批准方案**——学员检查通过后才动工。

**目标**：React UI 壳——固定布局 + 槽位渲染 + schema 设置表单 + 命令按钮。**外观参考 Cherry Studio，代码自己写。** 证明内核与表现层无关（同一内核已跑通 CLI，现在接 UI）。

**预期功能**：
1. 启动即 `loadFromDir(plugins)` + 激活全部（复用 CLI 的容错逻辑）。
2. 左栏渲染 `ui` 类型贡献（demo 的 `demo-panel`），点击在主区显示。
3. 命令按钮（`command` 贡献带 handler 的），点击执行并显示结果。
4. 设置表单：从插件 `manifest.settingsSchema` 渲染（string/number/boolean），保存写 `storage.namespace(pluginId).set("config", ...)`（与 demo 读取的 key 一致）。
5. 事件驱动刷新：订阅 registry onChange + `data:changed`，贡献/数据变化自动重渲染。

**明确不包含**（宁简勿繁）：拖拽块画布（那是后续图形画布里程碑）、多 agent 可视化、Cherry Studio 代码复制。

---

## 三、具体实现方案

### 技术栈与结构

```
packages/ui-shell/
  package.json        # vite + react + @minex/kernel
  vite.config.ts      # dev server（proxy 无需，纯前端）
  index.html
  src/
    main.tsx          # 入口
    bootstrap.tsx     # createKernel → loadFromDir → 激活全部 → 渲染（加载态/错误态）
    kernel-context.tsx# React context 暴露 kernel 宿主视图
    App.tsx           # 布局：顶栏 + 左栏 + 主区
    components/
      TopBar.tsx      # 标题 + 设置按钮 + 插件状态
      Sidebar.tsx     # 插件列表 + ui 贡献导航
      SlotRenderer.tsx# query("ui") 按 location 分组渲染
      SettingsForm.tsx# 通用 JSON Schema 表单（string/number/boolean）
      CommandRunner.tsx# query("command") 有 handler 的渲染按钮，执行后显示结果
    useKernel.ts      # 订阅事件触发的重渲染 hook
```

### 数据流

```
React 挂载 → bootstrap: createKernel → loadFromDir(./plugins) → 逐个激活
   → kernel-context 提供 kernel
   → App 渲染固定布局
   → Sidebar: plugins.list() + registry.query("ui") 按 location 分组
   → CommandRunner: registry.query("command") → 按钮 → 调 handler → 结果进主区
   → SettingsForm: manifest.settingsSchema → 表单 → storage.namespace(id).set("config", values)
   → useKernel: 订阅 registry.onChange / events.on("data:changed") → setState 重渲染
```

### 关键设计决策

1. **UI 壳 = 又一个宿主**：只读 `registry/storage/events/plugins` 宿主视图（与 CLI 同一边界），不绕开 PluginContext、不 import 内核内部。**这本身是内核「领域无关」的验收**。
2. **设置 key 约定**：`storage.namespace(pluginId).get/set("config")`——与 demo、CLI 已用 key 一致，三方对齐。
3. **设置表单通用化**：只支持 JSON Schema 的简单类型（string/number/boolean/嵌套 object 递归），不做完整 schema 表单库（那是过度设计）。
4. **事件刷新**：`useKernel` hook 订阅注册表 onChange（贡献增删）与 `data:changed`（数据变），触发重查——不做完整状态管理库。

### 验收标准

1. `npm run ui` → 浏览器打开 → 顶栏 + 左栏（Demo Panel）+ 主区。
2. 点击「Say Hello」按钮 → 主区显示 `Hello, world!`。
3. 设置表单显示 `greeting` 字段 → 修改保存 → `E:\Minex\.minex-data\minex.demo.json` 的 config 更新。
4. 修改 demo 源码 → reload 插件 → 界面刷新（事件驱动生效）。

---

## 四、审查标准（阶段 4 用）

### 必须通过

1. `npm run build` / `npm run typecheck` / `npm test` 全绿（含 66 用例不回退）。
2. 四项验收标准全部满足。
3. **UI 壳不 import 内核内部模块**（只 import `@minex/kernel` 公共入口）。

### 重点审查

- **P0 bootstrap**：插件加载失败是否隔离（CLI 的 C1 容错在 UI 端复用）；加载态/错误态是否处理。
- **P0 槽位**：`location` 字段约定是否清晰；未知 location 的贡献如何处置（忽略 vs 报错）。
- **P1 设置表单**：schema 渲染的覆盖面；非法值校验；保存失败路径。
- **P1 事件刷新**：onChange 与 data:changed 的订阅清理（避免内存泄漏）；刷新是否导致重渲染风暴。
- **P1 内核边界**：UI 是否碰了宿主不该碰的东西（如直接改 registry 内部）。

### 已知限制（勿误报为缺陷）

- 外观是「参考 Cherry Studio 风格」的实现，非逐像素复刻。
- 无拖拽画布（后续里程碑）。
- 浏览器端插件入口需编译为浏览器可 import 的模块（v1 用 dev 服务器直接加载 TS？或需构建——见实现时定）。
