# Minex 阶段 18 审查报告（markdown 编辑器驱动 + 设置卡死修复）

> 审查日期：2026-08-13　|　范围：markdown-driver 新包、App workspace 消费、appearance 调色板/CSS 预填、报告 17 遗留修复
> 对照：`docs/report-18.md`。React 语义问题按 React 官方行为判定，构建脚本问题经实测。

## 审查基线

- `npm run typecheck` ✅ `npm run build` ✅ `npm test` ✅ **三连全绿**（93/93，6 包）
- build 产物确认：`settings-view`/`workspace-view` 独立 chunk（惰性加载生效）

**报告 17 的 BLOCKER B1（DOM lib + filter 类型）已修复**——appearance-driver tsconfig 现在带 `lib: ["ES2022", "DOM", "DOM.Iterable"]`，且 markdown-driver 的 tsconfig 从第一天就带 DOM lib（教训已内化）。验证命令已固定为三连。

---

## 一、上一轮问题回归（report-17 审查）

| 上轮项 | 判定 |
|---|---|
| B1 typecheck 失败（DOM lib + filter） | ✅ 已修复（appearance tsconfig + index.ts 类型谓词） |
| B2 DriverDetail 组件内 lazy 重挂载 | ✅ 已修复（`useMemo(() => lazy(...), [settingsView, driverId])`，`DriverDetail.tsx:39-42`） |
| M1 closeTab updater 内副作用 | ✅ 已修复（拆两个独立 setState，`settings-view.tsx:49-54`） |
| M2 ThemeSettings 跨主题污染 | ✅ 已修复（`<ThemeSettings key={activeTheme.id}>`，`settings-view.tsx:89`） |

上一轮全部 BLOCKER/MAJOR 均已修复且有代码定位，基线健康。本轮无 BLOCKER。

---

## 二、MAJOR（建议修）

### M1 — `persistThemes` 在 setState updater 内做副作用（写 storage + emit 事件）
`packages/appearance-driver/src/settings-view.tsx:34-41`

```tsx
function persistThemes(updater) {
  setThemes((prev) => {
    const next = updater(prev);
    kernel.storage.namespace(...).set(THEMES_KEY, next);   // 副作用 1
    kernel.events.emit("minex:dataChanged", {...});         // 副作用 2
    return next;
  });
}
```

**判定**：这是与 report-17 M1 同源的反模式——setState 的 updater 必须是纯函数。此处为了修「闭包旧值」改用函数式更新，却把副作用移进了 updater：

- React 18 的 updater 在 **render 阶段**执行，此时 `emit("minex:dataChanged")` 会同步调用所有订阅者 handler（SettingsPage / App 的 `setTick`）→ **在 render 阶段调度其他组件的 setState**，触发 React「Cannot update a component while rendering a different component」警告；
- StrictMode 下 updater 被 double-invoke → storage 写两次、emit 两次。

**修复**：用 `useRef` 保存最新 themes，在 updater **之外**做副作用：
```tsx
const themesRef = useRef(themes);
themesRef.current = themes;
function persistThemes(updater) {
  const next = updater(themesRef.current);
  setThemes(next);
  kernel.storage.namespace(...).set(THEMES_KEY, next);
  kernel.events.emit("minex:dataChanged", {...});
}
```

### M2 — `drivers:sync` 脚本遗漏 markdown-driver 的构建
根 `package.json` `drivers:sync`

```
"drivers:sync": "npm run build -w minex-appearance-driver -w minex-demo-driver && node scripts/sync-drivers.mjs"
```

`sync-drivers.mjs` 扫描所有带 manifest.json 的驱动包（含 markdown），但前置 build 只 build appearance + demo。**实测本次 sync 成功**，纯粹因为三连里的 `npm run build` 已先 build 过 markdown（dist 已存在）。

**真实风险**：fresh checkout 直接跑 `drivers:sync`（不先跑 build）→ markdown 的 `dist` 不存在 → `cpSync` 抛 ENOENT 中断；改 markdown 源码后 `drivers:sync` 同步的是**过期产物**。

**修复**：`drivers:sync` 加 `-w minex-markdown-driver`。

---

## 三、MINOR（可留）

- **m1** `renderMarkdown(doc)` 在 WorkspaceView 每次渲染都全量 parse（无 `useMemo`），大文档每次按键卡顿（`workspace-view.tsx:44`）。
- **m2** markdown 编辑区 `dangerouslySetInnerHTML` 注入 marked 输出，无 sanitize——marked 默认透传原始 HTML。v1 全信任模型（用户自编辑自己）下非漏洞，未来渲染第三方 markdown 需 `DOMPurify` 或 `marked` 的 sanitize 选项。
- **m3** markdown settings-view 的「代码块字体」只写 storage 不发 CSS（无 theme 贡献、无 `--font-code` 更新）→ **设置不生效**，纯占位。报告 18 已知限制（「尚未接扩展点」），但严格说是「存了值却没有消费路径」。

---

## 四、INFO（观察）

- **调色板渐变修复正确**：`.sv-plane` 用 `background-image: linear-gradient(...)`（白→透明 + 透明→黑），内联只设 `backgroundColor`（hue 纯色），不再用 `background` 简写覆盖渐变。SV 平面视觉正确。
- **workspace 消费的 useMemo 依赖稳定**：`useMemo(() => (workspaceView ? lazy(workspaceView.value.load) : null), [workspaceView, activeDriverId])`——`workspaceView` 是 registry 里稳定引用，`activeDriverId` 变化才重算 → 同驱动内编辑不重挂载、切驱动重挂载。✓
- **Hooks 规则修复正确**：App 所有 useState/useEffect/useMemo 均在 `if (view === "settings") return` 之前（`App.tsx:76`），「设置卡死」根因消除。
- **Resizer** 已累计修复 report-15（基准 `initialWidth` 快照）+ report-13 W5（blur 兜底 + 卸载清理 `cleanupRef`），拖拽语义正确。
- **marked 同步渲染**：`marked.parse(md, { async: false }) as string`，marked ^12 默认同步，断言成立。
- **markdown.render 复用契约**：`ctx.register("markdown", "render", { render })` → `ctx.get("markdown", "render").render(md)`，类型 `{ render: (md) => string }`，清晰。
- markdown-driver 从创建就带 `lib: DOM` + `jsx: react-jsx` + React peer/dev 依赖，无 report-17 B1 同类问题。
- manifest `hasWorkspace: true` 使 markdown 出现在顶栏选择器；demo/appearance 无 workspace → 选择器正确只列 markdown。

---

## 五、报告 18 验收逐条判定

| 标准 | 判定 |
|---|---|
| typecheck && build && test 三连全绿 | ✅ 93/93 |
| 顶栏「Markdown 编辑器」+ 三模式切换 | ✅（hasWorkspace + workspace-view 三模式） |
| 设置页不卡死 + 返回正常 | ✅（useMemo 已在条件 return 之前） |
| markdown.render 渲染标题/代码块/列表/引用 | ✅（marked 能力完整；无单测覆盖） |

---

## 六、测试缺口

- markdown-driver **零测试**（`renderMarkdown` 纯函数本应 3 行单测即可覆盖，报告 18 验收标准 4 依赖它却无测试）。
- persistThemes（M1）、workspace 消费（useMemo 稳定性）无 React 渲染测试——M1 由此漏检。
- `drivers:sync` 无「fresh checkout 直接 sync」的验证（M2 由此漏检，本次靠三连 build 偶然掩盖）。

---

## 七、结论与修复优先级

本轮是**修复轮**：报告 17 的 4 个 BLOCKER/MAJOR 全部修复、三连全绿、调色板渐变正确、workspace 消费的 useMemo 设计正确（吸取了 B2 教训），markdown 驱动功能完整。剩余两个 MAJOR 都在「副作用位置」与「构建脚本自包含」上：

1. **M1** persistThemes 副作用移出 updater（用 ref，约 5 行）——React 渲染正确性。
2. **M2** drivers:sync 补 markdown build（约 1 个 token）——CLI 宿主自包含。
3. 补 renderMarkdown 单测（验收标准 4 目前零覆盖）+ persistThemes 相关 React 测试。

**流程观察**：本轮流程健康——上轮问题有回归验证、三连命令固定、新包从第一天就带 DOM lib（B1 教训内化）。这是连续三轮（report-16/17/18）里第一次「三连真全绿」，改进明显。
