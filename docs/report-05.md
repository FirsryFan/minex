# Minex 阶段报告 05（2026-08-12）

> 报告制度（固定四节）：① 上次审查修改结果 + 代码定位 + 额外发现 ② 本轮目标与预期功能 ③ 具体实现 ④ 审查标准。

---

## 一、上次审查问题的修改结果（v0.2.2，阶段 3 检阅）

| # | 问题 | 修复方式 | 代码定位 | 验证 |
|---|---|---|---|---|
| C1 | main 激活循环无容错 | 逐个 try/catch，失败汇入 failed | `packages/cli/src/main.ts:29-39` | `test/main.test.ts` "C1: main survives…" |
| C2 | 静态 label 被 activate 覆盖丢失 | **registry 分层存储**：每个 (type,id) static/runtime 两层，`effective = runtime ?? static` | `packages/kernel/src/registry.ts` 全文件 | `test/loader.test.ts` "C2: static label survives…" |
| C3/C4/C5 | CLI 错误输出 stack trace | main 顶层 try/catch → `错误: <msg>` | `packages/cli/src/main.ts:42-47` | `test/main.test.ts` "C3: main catches…" |

测试 63 → **66**。额外发现：分层存储从根上解决 L2（纯静态与「静态→运行时升级」共用一机制）；`^0.2.1` caret 自动匹配 0.2.2。

---

## 二、本轮目标与预期功能（阶段 4：UI 壳，tag v0.4.0）

**目标**：React UI 壳——固定布局（顶栏/左栏/右栏/主区/浮窗）+ 槽位 + schema 设置表单 + 命令按钮。外观为**浅色蓝主题**（CSS 令牌驱动，可整体换肤）。**内核与表现层无关的第二个宿主证明（第一个是 CLI）**。

**预期功能**：
1. 启动加载插件（Vite 打包，内存存储）+ 逐个容错激活。
2. 左栏渲染 `ui` 贡献（demo-panel），点击主区显示。
3. 右栏命令按钮（有 handler 的 command），点击主区显示结果。
4. 设置浮窗：schema 表单，保存写 `storage.namespace(id).set("config")`。
5. 事件驱动刷新（registry onChange + `data:changed`）。
6. 布局细节：左右栏可折叠（主区顶条两侧按钮）、主区抬升圆角层、浮窗 61.8vw 遮罩。

---

## 三、具体实现内容

### 文件清单与联系

| 文件 | 职责 |
|---|---|
| `packages/ui-shell/package.json` | vite + react + @minex/kernel |
| `packages/ui-shell/vite.config.ts` | react 插件 + node:fs/path/url 浏览器 stub 别名 |
| `packages/ui-shell/src/theme.css` | **浅色蓝主题令牌**（--color-primary 蓝 / --floating-max-width:61.8vw / 圆角 / 间距） |
| `packages/ui-shell/src/index.css` | 结构样式：grid 布局、主区抬升、圆角卡片、浮窗遮罩——只用 var() 不写死 |
| `packages/ui-shell/src/stubs/{fs,path,url}.ts` | node: 内建浏览器 stub（抛错，永不被调用；Rollup 具名导入兼容） |
| `packages/ui-shell/src/plugins.ts` | v1 显式插件清单（Vite 直接加载 demo 源码 + manifest.json） |
| `packages/ui-shell/src/bootstrap.tsx` | createKernel(内存存储) → registerStatic → register → 逐个激活 → 渲染 |
| `packages/ui-shell/src/App.tsx` | 布局状态（折叠/选中面板/命令结果/设置浮窗）+ 事件刷新订阅 |
| `packages/ui-shell/src/components/*` | TopBar / Sidebar / MainArea / RightBar / FloatingWindow / SettingsForm |

### 关键设计决策

1. **结构 / 外观分离**：组件只用 `var(--*)` 令牌，所有颜色/圆角/61.8vw 都在 `theme.css`——换肤改一个文件。
2. **分层布局 |q--p|**：顶/左/右 `--color-bars` 同底色一层；主区 `margin + z-index` 抬升 + 圆角。
3. **浏览器宿主复用 `registerStaticContributions`**（从 loader 导出）：静态贡献机制跨 Node/浏览器一致。
4. **浏览器 stub**：Vite 别名 node:fs/path/url → 抛错 stub（Rollup 具名提升兼容）。浏览器路径用内存存储 + 直接注册，永不触达 fs。
5. **折叠**：CSS grid 模板列 0↔sidebar-w 过渡；按钮在主区顶条两侧。

---

## 四、审查标准（阶段 4）

### 必须通过

1. `npm run build` / `npm run typecheck` / `npm test` 全绿（66 不回退）。
2. `npm run ui` → http://localhost:5173 → 布局渲染（顶/左/右 + 抬升主区），左栏 Demo Panel、右栏 Say Hello。
3. 点 Say Hello → 主区结果；设置改 greeting → 保存 → 刷新后数据在。
4. **换肤验证**：改 `theme.css` 一个 `--color-primary` → 全界面变色（外观未写死）。
5. UI 壳不 import 内核内部模块（只 import `@minex/kernel` 公共入口 + registerStaticContributions）。

### 重点审查

- **P0 浏览器 stub**：Rollup 具名导入覆盖是否完整；有没有浏览器路径意外触达 fs 的路径。
- **P0 bootstrap 容错**：单个插件激活失败是否隔离（与 C1 对齐）；destroy 清理。
- **P1 SettingsForm**：schema 渲染覆盖面（string/number/boolean）；`plugin!` 非空断言风险。
- **P1 事件刷新**：onChange/on 退订清理；重渲染风暴。
- **P1 折叠/浮窗**：grid 过渡、遮罩点击关闭、stopPropagation。
- **P1 内核边界**：UI 是否绕过 PluginContext 直接改 registry 内部。

### 已知限制（勿误报为缺陷）

- 插件经 Vite 打包加载（显式清单 v1），非运行时文件发现（那是 Electron 主进程宿主的事）。
- `plugin!` 非空断言依赖「有 settingsSchema 的插件已加载」。
- UI 未做自动化测试（v1 靠构建 + dev 验证；手动验收由学员跑 `npm run ui`）。
