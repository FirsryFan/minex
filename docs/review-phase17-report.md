# Minex 阶段 17 审查报告（6 条反馈修复 + appearance 重构）

> 审查日期：2026-08-13　|　范围：report-17 的 6 条反馈 + 前序 report-15/16 的 appearance 重构
> 对照：`docs/report-17.md`（含 report-16 的 settingsView 机制背景）。React 语义问题按 React 官方行为判定，内核交互经 node 脚本验证。

## 审查基线

- `npm test` ✅ **93/93** 全绿（13 文件）
- `npm run typecheck` ❌ **失败**（appearance-driver 11 个错误）
- `npm run build` ❌ 失败（appearance tsc 步骤失败）

**报告 17 声称「构建/类型检查/测试全绿（验证 agent 执行）」与实际不符——typecheck 未通过**。验证 agent 显然只跑了 `npm test`（vitest 不 typecheck），没跑 `npm run typecheck`/`build`。这是流程问题（与 report-10 同类，但方向相反：那次是测试没跑，这次是类型检查没跑）。

---

## 一、BLOCKER（必须修）

### B1 — appearance-driver 类型检查失败：新增 React 组件但 tsconfig 缺 DOM lib
`packages/appearance-driver/tsconfig.json` + `src/settings-view.tsx`

11 个错误，两类：

1. **10 个 DOM 类型缺失**（`settings-view.tsx`）：`HTMLSelectElement`/`HTMLDivElement`/`MouseEvent`/`window` 全部 `Cannot find name` 或 `Property does not exist`。根因：tsconfig 只 `extends` 根配置（lib 仅 `ES2022`）+ `jsx: react-jsx`，**未加 `lib: ["DOM", "DOM.Iterable"]`**（对比 `ui-shell/tsconfig.json` 有）。
2. **1 个类型收窄失败**（`index.ts:35`）：`[s.enFont, s.zhFont].filter(Boolean).map(quoteFont)` —— `filter(Boolean)` 后类型仍为 `(string | undefined)[]`，`quoteFont(name: string)` 拒绝 `string | undefined`。

**修复**：
- tsconfig 加 `"lib": ["ES2022", "DOM", "DOM.Iterable"]`；
- `index.ts` 改 `filter((f): f is string => Boolean(f))`（或显式类型谓词）。

### B2 — `DriverDetail` 组件体内调用 `lazy()`，每次渲染重挂载 SettingsView → 状态全重置
`packages/ui-shell/src/components/DriverDetail.tsx:39`

```tsx
const settingsView = kernel.registry.get<...>("settingsView", driverId);
if (settingsView) {
  const View = lazy(settingsView.value.load);   // ← 每次渲染新建 lazy 对象
  return <Suspense ...><View kernel={kernel} /></Suspense>;
}
```

**判定**：`lazy()` 必须在模块作用域或 `useMemo` 里调用。组件体内每次渲染返回**新的 Lazy 组件对象**（引用不同）→ React 视为不同组件类型 → 每次重渲染都**卸载旧 SettingsView、挂载新的**。

**触发链**（必然发生）：用户在主题选项卡改颜色 → `setField` → `persistThemes` → `emit("minex:dataChanged")` → SettingsPage 的 `setTick` → DriverDetail 重渲染 → 新 `lazy()` 对象 → **SettingsView 重挂载，tabs 回到 `[介绍, 管理主题]`、activeTab 回 "介绍"、主题选项卡被关闭**。

**后果**：真选项卡系统（report-17 #5 的核心）直接崩溃——用户每改一次设置就被踢回「介绍」页，无法连续编辑主题。这是本轮最严重的功能 bug，report 16 的「双击打开主题选项卡 + 修改即时生效」验收（标准 3/4）实际无法成立。

**修复**：`const View = useMemo(() => lazy(settingsView.value.load), [driverId])`（或提升到 `useState` 初始化）。

---

## 二、MAJOR（建议修）

### M1 — `closeTab` 在 setState updater 内调用另一个 setState（React 反模式）
`packages/appearance-driver/src/settings-view.tsx:46-52`

```tsx
function closeTab(id) {
  setTabs((prev) => {
    const next = prev.filter((t) => t.id !== id);
    if (activeTab === id) setActiveTab(...);   // ← updater 内副作用
    return next;
  });
}
```

setState 的 updater 必须是纯函数。在 updater 里调用 `setActiveTab` 会在渲染阶段调度更新，触发 React 18 的「update during render」警告，严格模式下 updater 被 double-invoke 导致 setActiveTab 调用两次。**关闭当前激活 tab 的回退逻辑因此不可靠**（P0 重点审查项）。

**修复**：拆成两个独立 setState，用闭包 `tabs` 计算 `next`：
```tsx
const next = tabs.filter(t => t.id !== id);
setTabs(next);
if (activeTab === id) setActiveTab(next.length ? next[next.length - 1].id : "manage");
```

### M2 — `ThemeSettings` 的 `settings` state 不随切换主题重置，跨主题污染
`packages/appearance-driver/src/settings-view.tsx:126`

```tsx
const [settings, setSettings] = useState(theme.settings ?? {});  // 仅在首次挂载执行
```

`ThemeSettings` 由 `{activeTheme && <ThemeSettings theme={activeTheme} />}` 渲染，切换主题 tab 时组件**不卸载**（同类型复用），`theme` prop 变了但 `useState` initializer 不重跑 → **settings 残留上一个主题的值**。用户先编辑主题 A 再切到主题 B，B 的表单显示 A 的旧值，且 `onSave` 把污染后的 settings 写回 B。

**修复**：`<ThemeSettings key={activeTheme.id} ...>` 强制切换时重挂载，或加 `useEffect(() => setSettings(theme.settings ?? {}), [theme.id])`。

---

## 三、MINOR（可留）

- **m1** ColorField 的 `sv-plane` 背景只用单一 hue 色（`hsvToHex(hsv.h, 100, 100)`），不是真正的 S/V 平面渐变——拖动把手位置正确但视觉预览不准确。
- **m2** ColorField 色板无「点外部关闭」。
- **m3** `FontRow` 空值（未选字体）时按钮无占位文案，用户看不出当前是默认字体。
- **m4** `--color-danger` 已定义令牌但 UI 未使用（`--color-warning` 已用于 pending 徽标）。属「提示色已定义、UI 部分未接」的延续。
- **m5** `hexToHsv` 对非法 hex（含非十六进制字符）返回 NaN 传播，无兜底（ColorField 输入恒为滑块生成的合法 hex，暂不触发）。

---

## 四、INFO（观察）

- **W1 已彻底修复**（上轮 report-13 遗留）：`plan-apply.ts` 纯函数（传递依赖闭包 + 深度拓扑排序 + 冲突检测），SettingsPage.applyAll 接入，`plan-apply.test.ts` 6 用例覆盖冲突/拓扑/顺序。✓
- **W2 已修复**：`quoteFont` 给含空格字体名加引号，`build-css.test.ts` 覆盖「Microsoft YaHei 带引号」「不重复加引号」。✓
- **背景派生**：`backgroundColor` 派生 `--color-card`（92% bg + white）/ `--color-hover`（96% bg + white），有 build-css 测试 ✓。`color-mix` 需现代浏览器（Chrome 111+），深色下 card 比 bg 更亮（掺白）方向正确。
- **双主题 apply**：`themes.find(mode)` 各自取设置，找不到对应 mode 主题时 `settings={}` → 生成空 CSS（`sel {}`）——兜底存在但表现为「该模式回退系统默认主题」，非致命。
- **主题链路无环** ✓：apply 只由 activate/data:changed 触发，驱动不订阅 theme onChange。
- **惰性隔离设计正确**：`settingsView` 贡献 `{ load }`，Node(CLI) 不调 `load()` 不加载 React——但 B2 使浏览器侧惰性加载的**组件实例**每次重渲染失效（load 本身有模块缓存，问题在 lazy 引用）。
- **report-15/16 验收**：Resizer 基准（按下时快照）✓、背景分层（bg 为所有底色）✓、humanize 驼峰 ✓、字体预览（选项用自身字体渲染）✓、README?raw 声明 ✓。
- 颜色滑块 `hexToHsv`/`hsvToHex` 有 round-trip 测试 ✓，`padStart` 正确。

---

## 五、报告 17 六条反馈逐条判定

| # | 反馈 | 判定 |
|---|---|---|
| 1 | 背景色联动 + 变量名统一 | ✅ 派生 card/hover；warning/danger 替代 unfinished/error（buildCss + theme.css 一致） |
| 2 | 双主题 + 默认选择 | ✅ DEFAULT_THEMES 浅/深两卡片 + apply 按 mode 取设置（「指定默认」未做 UI 属已知限制） |
| 3 | 字体全局一致 | ✅ `input/select/textarea/button { font-family: inherit }` |
| 4 | 删冗余说明 | ✅ RightBar 清空；「（默认）」已删（SettingsForm 仅余 font 字段的「Preview 字体预览」功能文本，非冗余） |
| 5 | 真选项卡 | ◐ **实现有致命缺陷**（B2 每次重挂载 + M1 closeTab 反模式 + M2 跨主题污染） |
| 6 | 交互反馈 + 颜色滑块 | ✅ hover 上弹 translateY、颜色 R/G/B 滑块（ColorField）；sv-plane 视觉简化（m1） |

---

## 六、结论与修复优先级

本轮功能方向正确（背景联动、双主题、字体继承、颜色滑块、W1/W2 修复都很扎实），但**基线不绿 + 一个核心崩溃 bug**，必须修完才算完成：

1. **B1**（BLOCKER）补 DOM lib + 修 filter 类型——恢复 typecheck/build，约 2 行。
2. **B2**（BLOCKER）`lazy` 提 `useMemo`——真选项卡系统的崩溃根因，约 1 行。
3. **M1/M2** closeTab 拆分 setState、ThemeSettings 加 key——B2 修复后立即显现的两个次生 bug。
4. 补 React 组件测试（B2/M1/M2 均因 UI 无自动化测试而漏检；当前 93 个测试里没有 React 渲染测试）。

**流程观察**：本轮再次出现「声称全绿但实际 typecheck 失败」——验证 agent 只跑了 `npm test`。建议把验证命令固定为 `npm run typecheck && npm run build && npm test` 三连，且**新增 DOM/React 代码的包必须核对 tsconfig 的 lib 配置**（appearance-driver 从纯 Node 包变成含 React 组件的混合包，这是 B1 的根因）。
