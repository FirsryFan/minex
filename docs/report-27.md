# Minex 阶段报告 27（2026-08-13）—— 阶段 26 审查修复（浮窗 blur 兜底 + 默认浮窗关闭语义）

> 报告制度（固定四节）。本轮内容：执行 `review-phase26-report.md` 修复——M1（浮窗无 blur 兜底会「卡住」）+ m1（defaultDock:"floating" 关闭语义）。BLOCKER（浮窗拖拽后无法再次拖动）已由用户方修复（监听常驻 + ref 存回调 + preventDefault），本轮确认无回归。
> 前置：`docs/report-26.md` → `docs/review-phase26-report.md`。

---

## 一、上次问题回归

- **BLOCKER（拖拽后无法再次拖动）**：已由用户方修复（`FloatingPanel.tsx`：监听常驻 + `onMoveRef/onResizeRef` 存回调 + `onMouseDown.preventDefault`）。本轮仅确认保留、未回退。
- **M1（浮窗无 blur 兜底）**：本轮已修（`window.addEventListener("blur", up)`，对比 `Resizer`）。
- **m1（默认浮窗关闭语义）**：本轮已修（`hiddenPanels` + `dockPanel` 按 defaultDock 分支）。
- 回归面：三连保持全绿（本轮实测 18 文件 / 155 测试）。

---

## 二、本轮目标与内容

| # | 内容 | 定位 |
|---|---|---|
| 1 | M1：浮窗 blur 兜底 | `FloatingPanel.tsx` 常驻监听补 `blur`（窗口失焦释放拖拽，不「卡住」） |
| 2 | m1：默认浮窗关闭语义 | `App.tsx` 加 `hiddenPanels`；`dockPanel` 对 `defaultDock:"floating"` 永久隐藏、对浮起面板回 dock |
| 3 | m2 待办记录 | Resizer 图标化 + 浮窗贴靠（S4 与「多开」一起规划） |

---

## 三、具体实现

### 文件清单与联系

| 文件 | 职责 |
|---|---|
| `ui-shell/src/components/FloatingPanel.tsx` | 常驻监听补 `window.addEventListener("blur", up)` + cleanup 移除（M1） |
| `ui-shell/src/App.tsx` | `hiddenPanels` state；`floatingAll` 过滤 hidden；`dockPanel` 按 defaultDock 分支（m1） |

### 关键代码定位（file:line，供审查对照）

| 改动点 | 定位 |
|---|---|
| blur 兜底 | `ui-shell/src/components/FloatingPanel.tsx:58-64` |
| hiddenPanels state | `ui-shell/src/App.tsx:40` |
| floatingAll 过滤 hidden | `ui-shell/src/App.tsx:99` |
| dockPanel 默认浮窗分支 | `ui-shell/src/App.tsx:124-132` |

### 关键设计

1. **blur 兜底**（M1）：拖拽类交互标准范式——`mousedown` 设 dragRef、`mouseup`/`blur` 清状态；监听常驻 + ref 存回调 + blur 兜底，三者共同保证可反复拖、失焦不卡（与 `Resizer` 语义对齐）。
2. **默认浮窗关闭 = 永久隐藏**（m1）：`defaultDock:"floating"` 的面板关闭后进 `hiddenPanels`（不回归 dock，因为其 dock 位置不存在）；浮起的面板关闭回 `defaultDock`。当前无默认浮窗面板（filesystem/markdown 为 left/main），逻辑为未来面板预埋。

---

## 四、审查标准

### 必须通过（已亲自验证，外部复核）

1. 三连全绿：`typecheck exit 0`（7 包）／`build exit 0`／`test 155/155`（18 文件）。
2. 浮窗可**反复**拖拽（第一次拖拽后不失效）；拖拽中窗口失焦 → 不卡住（下次鼠标移动浮窗不跟随）。
3. 浮起的面板关闭 → 回停靠；缩放正常。

### 重点审查

- **P0 监听生命周期**：`mousemove`/`mouseup`/`blur` 三监听在挂载时注册、卸载时全部移除；`up` 只清状态不移除监听。
- **P1 hidden 语义**：`dockPanel` 对 `defaultDock:"floating"` 隐藏后，`floatingAll` 不再包含它（`!hiddenPanels.includes`）。
- **P1 回归**：浮起/停靠/缩放对 left/main 面板行为不变。

### 已知限制 / 待办（勿误报）

- **m2 待办**（review-phase26）：侧栏 Resizer 图标化（可见 UI + 方位光标）；浮窗贴靠（snap to dock，靠近栏位显示高亮框回归停靠）——建议 S4 与「工作视图多开」一起规划。
- 默认浮窗（defaultDock:"floating"）关闭后无 UI 重新显示入口（当前无此类面板，未来接入时补「重新打开」）。

---

**提交状态**：本轮改动独立提交：`fix(ui): 阶段26审查修复（浮窗 blur 兜底 + 默认浮窗关闭语义）`。
