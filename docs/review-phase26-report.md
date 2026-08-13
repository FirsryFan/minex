# Minex 阶段 26 审查报告（S3 外壳面板化 + 浮窗）+ 拖拽严重 bug 修复

> 审查日期：2026-08-13　|　范围：Panel 抽象、FloatingPanel、App 面板化布局、filesystem/markdown 驱动迁移、m1 归一化
> 对照：`docs/report-26.md`。附带：本轮回合同步修复用户报告的「浮窗拖拽后无法再次拖动」严重 bug。

## 审查基线

- `npm run typecheck` ✅ **exit 0（7 包）**
- `npm run build` ✅ **exit 0**
- `npm test` ✅ **155/155** 全绿（18 文件）

---

## 一、BLOCKER（已修复）—— 浮窗拖拽后无法再次拖动

用户报告：「拖动之后放手就不能再次拖动，是个严重的 bug」。

### 根因
`packages/ui-shell/src/components/FloatingPanel.tsx`（原实现）：

```tsx
useEffect(() => {
  const move = ...;
  const up = () => {
    dragRef.current = null;
    resizeRef.current = null;
    window.removeEventListener("mousemove", move);   // ← 移除监听
    window.removeEventListener("mouseup", up);
  };
  window.addEventListener("mousemove", move);
  window.addEventListener("mouseup", up);
  ...
}, [onMove, onResize]);  // ← onMove/onResize 是内联函数，每次渲染变
```

**监听只在上面的 effect 挂载 / 依赖变化时添加一次**，而 `up`（mouseup 时）**永久移除了监听**。第一次拖拽结束（mouseup）→ 监听被移除 → 第二次 mousedown 只设置 `dragRef`，但 window 上已无 `mousemove` 监听 → 拖动失效。

对比同文件 `App.tsx` 的 `Resizer`：它在 `onMouseDown` 里**每次按下都重新 addEventListener**、`up` 时移除——所以 Resizer 能反复拖，FloatingPanel 不能。

### 修复（已落地）
1. **监听常驻**：`up` 只清理 `dragRef`/`resizeRef`，**不移除监听**；监听在 `useEffect([], ...)` 挂载一次、组件卸载时 cleanup 移除。
2. **ref 存回调**：`onMoveRef`/`onResizeRef` 存最新 `onMove`/`onResize`，effect 依赖 `[]`（否则内联函数会让 effect 每次渲染重建监听，拖拽中反复 add/remove）。
3. **`onMouseDown` 加 `e.preventDefault()`**：阻止拖标题/缩放把手时的文本选择。

修复后三连全绿（155 测试 + build 通过）。

---

## 二、MAJOR（建议修，用户报告的「严重 bug」的另一半）

### M1 — 浮窗无 `blur` 兜底，拖拽中窗口失焦会「卡住」
`FloatingPanel.tsx`（对比 `App.tsx` 的 `Resizer` 有 `window.addEventListener("blur", up)`）

`Resizer` 有 blur 兜底（窗口失焦视为释放），**FloatingPanel 没有**。拖拽浮窗过程中切到其他应用/窗口失焦 → `mouseup` 丢失 → `dragRef` 残留非 null → 之后鼠标移动（即使没按着）浮窗一直跟随——「拖拽卡住」。

**修复**：`up` 也注册到 `blur` 事件（或监听常驻方案下，`up` 逻辑抽成函数同时挂 `mouseup` + `blur`）。

---

## 三、MINOR（可留）

### m1 — `defaultDock: "floating"` 面板的「关闭」无效
`App.tsx:97` `floatingAll = panels.filter(p => p.defaultDock === "floating" || floatingIds.has(p.id))`

关闭一个 `defaultDock === "floating"` 的面板 → `dockPanel` 把它从 `floating` state 移除，但过滤条件里 `p.defaultDock === "floating"` 仍为 true → 它**仍在 `floatingAll`** → 关闭后立即重新渲染。当前无 `defaultDock: "floating"` 的面板（filesystem/markdown 都是 left/main），不触发；但一旦未来有默认浮窗面板，关闭即失效。需为「默认浮窗」定义独立的关闭语义（关闭 = 移除，不回归 dock）。

### m2 — 用户建议未实现（记待办）
- **侧栏 Resizer 图标 + 方位光标**：当前 Resizer 是 4px 透明条（hover 才显色），用户建议改为可见的 UI 图标 + `cursor` 方位坐标轴形状，按下后自然变浮窗拖动。
- **浮窗贴靠（snap to dock）**：靠近左右栏时显示高亮框/虚线框，无缝回归原停靠位（无需精确瞄准）。当前报告已知限制「浮窗无边界吸附」——建议作为 S4 打磨项，与「多开」一起规划。

---

## 四、INFO（观察）

- **Panel 抽象正确**：`queryPanels` 用 `.map(c => c.value)`（宿主视图剥壳，`panels.ts:28`）；驱动注册面板用字面量对象（零跨包 import，`filesystem-driver/index.ts:16-31`、`markdown-driver/index.ts:87-93`）。
- **旧 sidebar/workspace 贡献已清除** ✓（filesystem/markdown 迁移到 `panel`，无死引用，符合验收 5）。
- **lazy 面板缓存稳定** ✓：`panelLazy` 用 `Map` + `useMemo([panels])`，`lazy()` 只建一次，避免每次渲染重挂载（`App.tsx:105-110`）。
- **主区按活动驱动匹配** ✓：`mainPanel = docked.find(p => p.defaultDock === "main" && p.driverId === activeDriverId)`，保留「活动驱动决定主区」语义；活动驱动禁用时 main 面板消失、主体留空（`main-empty` 无文字）。
- **浮起/停靠状态流正确**：`floatPanel` 加入 floating、`dockPanel` 移除回 dock、`patchFloating` 对已浮起面板 patch、对未记录的面板（默认 floating）首次 patch 时补建 entry——对 left/main 面板正确。
- **m1（report-25）已修复** ✓：`parseMainChain` 把 `## 助手` 归一化为 `agentId: undefined`。
- 右栏当前无面板贡献（空）、左栏多面板 tab 切换、双击 tab 浮起——均符合报告设计。

---

## 五、报告 26 验收逐条判定

| 标准 | 判定 |
|---|---|
| 三连全绿（7 包 / 155） | ✅ 真全绿 |
| 左栏「文件」面板 + tab 切换 + 双击浮起 | ✅ |
| 主区按活动驱动显示面板 | ✅ |
| 浮窗可拖拽/缩放/关闭回停靠 | ◐ **拖拽后无法再次拖动（已修复）**；缩放/关闭正常 |
| 无旧 sidebar/workspace 死引用 | ✅ |

---

## 六、结论与修复优先级

本轮 S3 架构（Panel 抽象 + 驱动迁移 + 面板化布局）设计正确，但 FloatingPanel 的拖拽实现有严重缺陷（用户已报告，已修复），另有 blur 兜底缺失的「卡住」隐患。

1. **M1**（MAJOR）浮窗 `blur` 兜底（对比 Resizer 补齐，约 2 行）。
2. **m1**（MINOR）`defaultDock: "floating"` 关闭语义（未来面板接入前定义）。
3. **m2**（待办）Resizer 图标化 + 浮窗贴靠，建议 S4 与「多开」一起规划。

**给学员提示**：拖拽类交互的标准范式是「mousedown 时注册 move/up/blur、up 时一次性移除」（见 `Resizer` 的正确实现），或「监听常驻 + ref 存回调 + up 只清状态」（本次 FloatingPanel 修复采用的方案）。两者都能反复拖，**唯独「挂载时加一次监听 + up 里永久移除」是错的**——这是本次 bug 的直接原因。
