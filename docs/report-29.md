# Minex 阶段报告 29（2026-08-13）—— 阶段 28 审查修复（吸附 dockState 重构）+ 多实例隔离设计

> 报告制度（固定四节）。本轮内容：执行 `review-phase28-report.md`——BLOCKER（吸附「特效真、效果假」）重构为 `dockState` 运行时停靠模型；m1/m2/m3 修复；按审查建议出「多工作视图隔离边界」设计文档（先设计后代码）。任务视图 UI（问题 3）记录为下一步目标。
> 前置：`docs/report-28.md` → `docs/review-phase28-report.md`。

---

## 一、上次问题回归

- **BLOCKER（吸附特效真、效果假）已修** ✅：`defaultDock + floating 集合` → `dockState: Record<id, left|right|main|floating|hidden>`；吸附 = 改 dockState 为吸附目标，渲染按 dockState 分组。
- **m1** ✅：`computeSnap` 右缘判断改按右栏左边缘（`vw - widths.right - 20`）。
- **m2** ✅：session 能力暴露 `sessionPath(type, id)`，overview 不再硬编码 `.ses` 路径。
- **m3** ✅：FloatingPanel 加 `latestRef`（同步最新位置），onDrop 不再依赖 useEffect 异步的 `posRef`。
- 回归面：三连保持全绿（本轮实测 18 文件 / 155 测试）。

---

## 二、本轮目标与内容

| # | 内容 | 定位 |
|---|---|---|
| 1 | BLOCKER：吸附状态化 | `InstanceState` 改 `dockState: Record<string, PanelDock|hidden>` + `floatingPos`；浮起/吸附/关闭改 dockState；渲染按状态分组 |
| 2 | m1 吸附几何 | 右缘吸附按右栏左边缘判断 |
| 3 | m2 sessionPath | SessionStore 暴露 `sessionPath`，overview 复用 |
| 4 | m3 onDrop 位置 | FloatingPanel `latestRef` 同步最新位置 |
| 5 | 多实例隔离设计 | `docs/multi-view-isolation.md`：实例私有/全局共享清单 + 事件定向方案 + reload 占用检查（先设计后代码） |

---

## 三、具体实现

### 文件清单与联系

| 文件 | 职责 |
|---|---|
| `ui-shell/src/App.tsx` | `dockState`/`floatingPos` 模型；`dockOf` 分组（left/right/main/floating）；`floatPanel`/`dockPanel(id,target)`/`handleFloatDrop` 吸附决定目标；`computeSnap` 按右栏几何 |
| `ui-shell/src/components/FloatingPanel.tsx` | `latestRef` 同步位置（m3） |
| `session-driver/src/store.ts` | `SessionStore.sessionPath`（m2） |
| `session-driver/src/overview-view.tsx` | 打开会话用 `store.sessionPath`（m2） |
| `docs/multi-view-isolation.md`（新） | 多实例隔离边界设计：实例私有/全局共享 + 事件定向 + reload 占用 |

### 关键代码定位（file:line，供审查对照）

| 改动点 | 定位 |
|---|---|
| dockState 模型 | `ui-shell/src/App.tsx:24-32` |
| 渲染按 dockState 分组 | `ui-shell/src/App.tsx:140-145` |
| 浮起 / 停靠（吸附目标） | `ui-shell/src/App.tsx:158-178` |
| handleFloatDrop 吸附目标 | `ui-shell/src/App.tsx:194-197` |
| computeSnap 右栏几何 | `ui-shell/src/App.tsx:204-210` |
| latestRef（m3） | `ui-shell/src/components/FloatingPanel.tsx:43-44 / 55-56` |
| sessionPath（m2） | `session-driver/src/store.ts:34 / 105` |
| 隔离设计文档 | `docs/multi-view-isolation.md` |

### 关键设计

1. **`dockState` = 运行时停靠状态**：`defaultDock` 降级为「关闭时回退值」；`dockState[id]` 记录浮起/吸附/关闭后的实际位置，渲染按状态分组——吸附从「特效」变「真效果」（拖到右栏 → 停靠右栏）。
2. **`hidden` 并入 dockState**：默认浮窗（defaultDock:"floating"）关闭 = `hidden`（不渲染）；普通面板关闭回 defaultDock。
3. **隔离设计文档先行**（审查建议）：明确「内核单例 + 视图状态多份」边界，事件定向（payload `targetInstanceId`）+ doc 存储实例命名空间 + reload 运行时占用，分步实施。

---

## 四、审查标准

### 必须通过（已亲自验证，外部复核）

1. 三连全绿：`typecheck exit 0`（7 包）／`build exit 0`／`test 155/155`（18 文件）。
2. **吸附真效果**：文件树面板浮起后拖到右栏（右栏高亮）→ 释放 → 停靠右栏；拖到左栏 → 停靠左栏；拖到主区上缘 → 停靠主区。
3. 关闭浮起面板 → 回 defaultDock；默认浮窗关闭 → 隐藏（不渲染）。

### 重点审查

- **P0 dockState 一致性**：`dockOf` 回退 defaultDock；浮起初始化 floatingPos；吸附/关闭不残留脏状态。
- **P0 吸附目标生效**：`handleFloatDrop` 把 `snapTarget` 传给 `dockPanel(id, snapTarget)`（不再忽略）。
- **P1 几何判断**：右缘吸附按右栏左边缘（`vw - widths.right - 20`），非窗口边缘。
- **P1 隔离设计文档**：实例私有/全局共享清单完整；事件定向向后兼容（无 targetInstanceId 维持广播）。

### 已知限制 / 下一步（勿误报）

- **多实例隔离尚未落地代码**：doc 仍全局共享、openFile 仍全局广播、设置仍全局视图——设计文档已定（`docs/multi-view-isolation.md`），实施分步在下一步（先面板实例上下文 + openFile 定向 + doc 实例化 + reload 占用）。
- **任务视图 UI（问题 3）未实现**：目标记录——右上「双矩形重合」图标按钮（一虚一实）+ 单击弹横向预览浮窗，替换顶部 view-strip 选项卡。
- 吸附精确度依赖阈值（60px / 右栏-20 / 48px），非像素级对准。

---

**提交状态**：本轮改动独立提交：`fix(ui): 阶段28审查修复（吸附 dockState 重构）+ 多实例隔离设计文档`。
