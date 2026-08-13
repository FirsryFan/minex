# Minex 阶段报告 30（2026-08-13）—— 任务视图 UI（Windows Task View 风格工作区切换）

> 报告制度（固定四节）。本轮内容：落实 review-phase28 的目标（问题 3）——把顶部 view-strip 选项卡替换为「任务视图」：右上双矩形重合图标按钮 + 单击弹横向预览浮窗（各工作区缩略图/名称），点击切换。
> 前置：`docs/report-29.md` → `docs/review-phase28-report.md`（问题 3 记为目标，本轮实现）。

---

## 一、上次问题回归

- review-phase28 的 BLOCKER（dockState）/ m1/m2/m3 已在 report-29 修复，本轮无回归。
- **问题 3（任务视图）本轮完成** ✅。
- 回归面：三连保持全绿（本轮实测 18 文件 / 155 测试）。

---

## 二、本轮目标与内容

| # | 内容 | 定位 |
|---|---|---|
| 1 | 任务视图按钮 | `TopBar` 右上「双矩形重合」图标（一虚一实，自定义 SVG）；`taskViewActive` 高亮 |
| 2 | 横向预览浮窗 | `taskview-overlay` 遮罩 + `taskview-popup` 横向卡片（缩略图 + 名称），点击切换工作区 |
| 3 | 替换 view-strip | 移除顶部 view-strip/view-tab 选项卡 |
| 4 | 交互 | 点外部 / Esc 关闭；卡片 × 关闭工作区；＋ 新建 |

---

## 三、具体实现

### 文件清单与联系

| 文件 | 职责 |
|---|---|
| `ui-shell/src/components/TopBar.tsx` | 任务视图按钮（`TaskViewIcon` SVG 双矩形）+ `onOpenTaskView`/`taskViewActive` props |
| `ui-shell/src/App.tsx` | 移除 view-strip；`taskViewOpen` state + `selectInstance` + Esc 关闭 + 弹窗渲染 |
| `ui-shell/src/index.css` | `.taskview-*`（overlay/popup/card/thumb/add）+ `.taskview-btn.active`；删除 `.view-strip*` |

### 关键代码定位（file:line，供审查对照）

| 改动点 | 定位 |
|---|---|
| 任务视图图标（双矩形一虚一实） | `ui-shell/src/components/TopBar.tsx:13-19` |
| 按钮（右上，设置旁） | `ui-shell/src/components/TopBar.tsx:78-80` |
| taskViewOpen / selectInstance / Esc | `ui-shell/src/App.tsx:57-58 / 90-101` |
| 弹窗渲染（缩略图卡片 + 新建） | `ui-shell/src/App.tsx:168-198` |

### 关键设计

1. **任务视图 = 顶部选项卡的替代**：多开切换从「常驻 tab」改为「按钮 + 按需弹窗」，释放顶栏空间、贴近 Windows 任务视图交互。
2. **缩略图 = 布局示意**：迷你三栏色块（panel 侧栏 + card 主区），无真实截图（浏览器无便捷截图 API；后续可接 canvas 快照）。
3. **点击外部 / Esc 关闭**：overlay 遮罩点击关闭 + keydown Esc；卡片点击切换并关闭；卡片 × 关闭（保底 1 个）。

---

## 四、审查标准

### 必须通过（已亲自验证，外部复核）

1. 三连全绿：`typecheck exit 0`（7 包）／`build exit 0`／`test 155/155`（18 文件）。
2. 顶栏右上出现任务视图图标（两个重合矩形一虚一实）；点击弹出横向预览浮窗（各工作区缩略图 + 名称）。
3. 点击某工作区预览 → 切换到该工作区并关闭浮窗；点击外部 / Esc 关闭。
4. 卡片右上 × 关闭该工作区（≥2 个时可见）；「＋ 新建工作区」新建。

### 重点审查

- **P0 弹窗状态**：`taskViewOpen` 开关；Esc/外部点击清理；切换后正确 `selectInstance` + 关闭。
- **P1 图标语义**：双矩形一虚一实贴合 Windows 任务视图。
- **P1 布局**：overlay 遮罩（z-index 90）盖住工作区；popup 横向滚动（多工作区）。

### 已知限制 / 下一步（勿误报）

- 缩略图为布局示意色块，非真实内容快照（后续可 canvas 截图）。
- 多实例隔离（doc / openFile 定向 / reload 占用）仍按 `docs/multi-view-isolation.md` 待实施。
- 工作区实例状态仍不持久化（刷新回单实例）。

---

**提交状态**：本轮改动独立提交：`feat(ui): 任务视图（Windows Task View 风格工作区切换浮窗）`。
