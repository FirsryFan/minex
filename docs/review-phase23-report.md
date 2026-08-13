# Minex 阶段 23 审查报告（UI 精细打磨 + lucide 图标体系）

> 审查日期：2026-08-13　|　范围：7 条 UI 打磨反馈 + lucide-react 图标体系 + agent 驱动准备（方向）
> 对照：`docs/report-23.md`。类型/构建/测试经三连实测；React 语义按官方行为判定。

## 审查基线

- `npm run typecheck` ✅ **exit 0（6 包）**
- `npm run build` ✅ **exit 0**（有 1 个 chunk > 500kB 警告）
- `npm test` ✅ **129/129** 全绿（17 文件）

**这是连续多轮以来第一次「三连真全绿」**——报告 23 声称的 `typecheck exit 0 / build exit 0 / test 129/129` 与实测一致，验证 agent 本轮确实执行了完整三连。

---

## 一、上一轮（report-21）问题回归

| 上轮项 | 判定 |
|---|---|
| B1 `showDirectoryPicker` 缺类型 | ✅ 已修复（typecheck 6 包全绿） |
| M1 SidebarView 挂载误用 `openRoot()` 重弹窗 | ✅ 已修复（`sidebar-view.tsx:84-87` 改调 `refreshTree()` 恢复树，`openRoot()` 只由按钮触发；注释标注「审查 M1」） |

---

## 二、MINOR（可留，本轮无 BLOCKER/MAJOR）

### m1 — 打开文件触发一次无意义的自动保存 + 状态闪烁
`markdown-driver/src/workspace-view.tsx:119-131`

自动保存 effect 依赖 `[doc, currentPath]`。`openPath` 成功时 `setCurrentPath(path)` + `setDoc(content)` 两个 setState → effect 触发 → `setSaveStatus("编辑中…")` + 800ms 后 `persistDoc()`。**用户只是打开文件、尚未编辑，就被判为「编辑中」并写回一次相同内容**，工具栏状态闪烁「编辑中…→已保存」。

**建议**：用 `didEditRef`（在 `updateDoc`/`onWysiwygInput` 里置位，`openPath` 里复位）区分「真编辑」与「打开文件」，只有真编辑才进入防抖自动保存。

### m2 — `docRef/pathRef` 用 `useEffect` 同步（非渲染时），Ctrl+S 极边缘时序读旧值
`markdown-driver/src/workspace-view.tsx:81-87`

`useEffect(() => { docRef.current = doc }, [doc])` 在 commit 后异步执行。编辑后**同一帧内**立即按 Ctrl+S，`persistDoc` 读 `docRef.current` 可能是旧值。自动保存（800ms）不受影响。React 官方推荐在组件体直接 `docRef.current = doc`（渲染时同步），而非 useEffect。影响极小（边缘时序）。

### m3 — 未打开文件时 Ctrl+S 被拦截但静默无操作
`markdown-driver/src/workspace-view.tsx:107-117`

`persistDoc` 里 `if (!fs || !pathRef.current) return`，但 `preventDefault()` 已执行——markdown workspace 挂载但未打开文件时按 Ctrl+S，浏览器「保存网页」被拦截、文件也没存，用户无任何反馈。

### m4 — 主 chunk > 500kB，tree-shaking 声明与实际不符
`build` 输出警告「Some chunks are larger than 500 kB」。报告 P1 称「tree-shaking 生效（build 产物体积）」，但**主因是 `markdown.ts` 的 `import hljs from "highlight.js"` 全量导入**（highlight.js 默认入口注册全部语言，副作用使 tree-shaking 失效，约 ~1MB）+ katex。lucide-react 按需 import 本身是 tree-shakable 的。

**建议**：highlight.js 改 `highlight.js/lib/core` + 按需注册语言（`javascript`/`typescript`/`python` 等），可大幅减小 chunk。

### m5 — `NumberField` 空输入 onBlur 被设成 min
`appearance-driver/src/settings-view.tsx:482-487`

`Number("")` = 0（非 NaN）→ clamp 到 min。用户清空缩放输入框 → 失焦 → 跳回 50（min）。语义上「清空」与「输入 0」被混淆。

### m6 — `selectedPanelId` 死状态保留（报告已知限制 7）
MainArea 已删，但 `App.tsx` 的 `selectedPanelId` state + `Sidebar` 的 `onSelect` 仍在，纯死代码，待「侧栏面板系统」重做时清理。

---

## 三、INFO（观察）

- **两色分层正确**：`theme.css` 浅色 `--color-panel #e9eef6`（框架深）+ `--color-card #ffffff`（主体白）；深色 `#16233a`（框架暗）+ `#253244`（主体亮）——层次清晰，且 `--color-bg` 保留给按钮反白文字，语义分离合理。
- **折叠 width: 0** ✓（`.collapsed { width: 0 !important }`，收起无空隙，展开靠顶栏图标）。
- **细滚动条** ✓（`scrollbar-width: thin` + `::-webkit-scrollbar 6px`）。
- **选择器只列启用驱动** ✓（`App.tsx:75` 过滤 `getState === "activated"`；驱动禁用 → 运行时贡献清 → 主体空，无文字）。
- **自动保存 + Ctrl+S 主体设计正确**：防抖 800ms、`docRef/pathRef` 取最新值、window keydown 层 `preventDefault`、mac/win 兼容、wysiwyg 编辑同样触发、打开新文件清理旧 timer——P0 项核心路径均正确（仅 m1/m2/m3 边缘瑕疵）。
- **buildMarkdownCss 新字段 + 8 条目** ✓：lineHeight/headingColor/linkColor 输出正确，`codeWrap` 兼容布尔/"on"、`fontSize` 兼容字符串数字（历史形态兼容）。
- **lucide-react 用法正确**：按需 import（`Pen`/`Eye`/`Columns2`/`Zap` 等），`type LucideIcon` 类型，替换 emoji 全面。
- **agent 驱动准备**（方向）：`FileSystemAbility` 结构类型、事件协议范本、workspace/sidebar/settingsView/theme 贡献机制均已就绪——为下一里程碑铺路正确。
- 报告 23 的「关键代码定位 file:line」表详实，审查对照成本低。

---

## 四、报告 23 验收逐条判定

| 标准 | 判定 |
|---|---|
| 三连全绿 | ✅ **真全绿**（首次） |
| 两色分层 + 折叠无空隙 | ✅ |
| 细滚动条 | ✅ |
| 选择器只列启用驱动 + 禁用后主体空 | ✅ |
| 缩放输入过程不 clamp、失焦 clamp | ✅（NumberField onChange 只 setText、onBlur commit） |
| appearance 驱动设置 8 条目即时生效 | ✅ |
| markdown toolbar 重排 + 自动保存 + Ctrl+S | ✅（核心正确，m1/m2/m3 边缘） |
| 无 emoji | ✅ |

---

## 五、结论与修复优先级

本轮是**健康轮**：三连真全绿（首次）、report-21 的 B1/M1 已修复、两色分层/折叠/图标体系/自动保存主体设计都正确，验证流程本轮真实执行了完整三连。无 BLOCKER/MAJOR，6 个 MINOR 均不阻塞：

1. **m4** highlight.js 按需导入（收益最大，chunk 体积直接下降）。
2. **m1** 打开文件不触发自动保存（`didEditRef`，约 5 行）。
3. m2/m3/m5/m6 顺手修。

**流程观察（正面）**：连续四次「声称全绿实际失败」后，本轮第一次真三连全绿，且报告明确列出 `typecheck exit 0` 等退出码证据。建议把「贴退出码 + 错误输出」固化为后续验证 agent 的固定要求，防止流程回退。

**下一里程碑（agent 驱动）提示**：接口已就绪——`FileSystemAbility`（readDir/readFile/writeFile + 路径安全）、事件协议（payload 守卫）、workspace/sidebar/settingsView/theme 四类贡献 + 依赖注入（DRIVERS 顺序 + manifest dependencies）。agent 驱动可复用这些机制，重点注意：① agent loop 的长任务与 `destroy()`/deactivate 的清理对称；② 工具调用的能力复用（如 filesystem）要经 `registry.get(...).value`（宿主视图）；③ 上下文压缩/会话持久化需新 storage 键位，勿与既有 `doc`/`config`/`themes` 冲突。
