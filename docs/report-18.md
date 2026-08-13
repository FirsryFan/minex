# Minex 阶段报告 18（2026-08-13）—— markdown 编辑器驱动 + 设置卡死修复

> 报告制度（固定四节）。覆盖：调色板渐变修复 + CSS 代码预填 + markdown 驱动第一批 + 设置卡死修复。

---

## 一、本轮内容与修改结果

### 1. 调色板渐变 + CSS 代码预填（前置小修）

| 问题 | 修复 | 定位 |
|---|---|---|
| 调色板 SV 平面纯色 | 内联 `background` 简写覆盖了 CSS 渐变 → 改 `backgroundColor` | `appearance-driver/src/settings-view.tsx` |
| 初始主题无 CSS 代码 | DEFAULT_THEMES 加 `customCss` 默认值；ThemeSettings 加「CSS 代码」textarea | `theme.ts` + `settings-view.tsx` |

### 2. markdown 编辑器驱动（第一批，tag 26da7f7）

- `packages/markdown-driver/`：manifest（`hasWorkspace: true`）+ icon + README + marked 依赖。
- `src/markdown.ts`：`renderMarkdown(md)` 纯函数（marked 封装）。
- `src/index.ts` 贡献三能力：`markdown.render`（通用渲染）/ `workspace`（工作区）/ `settingsView`（设置）。
- `src/workspace-view.tsx`：编辑 / 预览 / 分屏三模式（textarea + marked 渲染）。
- `src/settings-view.tsx`：代码块字体设置。
- UI 壳 `App` 支持驱动 `workspace` 贡献（有则渲染驱动工作区，否则默认布局）。
- `drivers.ts` 加入 markdown；根脚本纳入 markdown build/typecheck。

### 3. 设置卡死修复（tag 57be0d3）

**根因**：`App` 的 `WorkspaceView` 的 `useMemo` 被放在 `if (view === "settings") return` 之后——切到设置视图时 hooks 数量变化（useMemo 不被调用），违反 React Hooks 规则 → React 崩溃/卡死。

**修复**：`useMemo` 移到条件 return 之前（与所有 useState/useEffect 同处组件顶层无条件调用）。

---

## 二、本批目标与预期

1. markdown 驱动：顶栏出现「Markdown 编辑器」，选中后工作区为编辑/预览/分屏三模式，编辑即时渲染。
2. 通用 markdown 渲染能力：`markdown.render` 供其他驱动（README 显示）复用。
3. 点击设置不再卡死。

---

## 三、实现要点

1. **workspace 消费**：`App` 用 `registry.get("workspace", activeDriverId)` 查驱动工作区，`lazy + Suspense` 渲染；无贡献回退默认布局（sidebar/main/rightbar）。
2. **markdown.render 复用**：驱动 `ctx.register("markdown", "render", { render })`，其他驱动 `ctx.get("markdown", "render").render(md)`（下一批接入 appearance README）。
3. **marked 同步渲染**：`marked.parse(md, { async: false }) as string`。

---

## 四、审查标准

### 必须通过

1. `npm run typecheck && npm run build && npm test` 三连全绿（验证 agent 执行）。
2. 顶栏选择器出现「Markdown 编辑器」；选中后工作区三模式可切换、编辑即时预览。
3. 点击顶栏「设置」→ 设置页正常显示（不卡死）；返回工作区正常。
4. `markdown.render` 能渲染含标题/代码块/列表/引用的 markdown。

### 重点审查

- **P0 Hooks 规则**：App 所有 hooks（useState/useEffect/useMemo）是否都在条件 return 之前；DriverDetail 的 SettingsView useMemo 同理。
- **P0 workspace 消费**：`WorkspaceView` useMemo 依赖 `[workspaceView, activeDriverId]`；切驱动时 lazy 引用是否稳定。
- **P1 marked 类型**：`marked.parse` 返回值断言；`async: false` 同步语义。
- **P1 工作区 CSS**：`.md-editor`/`.md-preview` 在纯编辑/纯预览模式下是否占满；分屏时各占一半。
- **P1 markdown.render 复用**：未来 appearance README 接入时的调用契约（`{ render: (md) => string }`）。

### 已知限制（勿误报）

- markdown 驱动的「代码块字体」尚未接 appearance「驱动设置」扩展点（第二批）。
- appearance README 仍是纯文本 `<pre>`，尚未改用 `markdown.render`（第二批）。
- 文件读写（打开/保存 .md）留待 Electron。
- 编辑区是纯 textarea（用户已确认非专业代码编辑器）。
