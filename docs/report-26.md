# Minex 阶段报告 26（2026-08-13）—— S3：外壳面板化 + 浮窗（Panel 抽象 / FloatingPanel / 驱动迁移）

> 报告制度（固定四节）。本轮内容：Mist 平台 S3——外壳从固定三段布局升级为「面板 + 浮窗」：驱动贡献面板（内容 + 默认停靠位），外壳渲染停靠面板（左/右/主区）与浮窗（拖拽/缩放/关闭回停靠）；filesystem/markdown 驱动迁移到 panel 贡献。连同 review-phase25 的 m1（`## 助手` 归一化）修复。
> 前置：`docs/report-25.md` → `docs/review-phase25-report.md`（无 BLOCKER/MAJOR，仅 m1）。

---

## 一、上次问题回归

- **m1（review-phase25）已修复** ✅：`parseMainChain` 把 `## 助手` 归一化为 `agentId: undefined`（与 `toMarkdown` 的无 agentId 渲染互逆），配测试（`session.test.ts`）。
- 回归面：三连保持全绿（本轮实测 18 文件 / 155 测试）；grep 确认无旧 `sidebar/workspace` 贡献死引用。

---

## 二、本轮目标与内容

| # | 内容 | 定位 |
|---|---|---|
| 1 | Panel 抽象 | `panels.ts`：`PanelContribution`（driverId / id / title / defaultDock / load）+ `queryPanels` |
| 2 | 驱动迁移 | filesystem/markdown 从 `sidebar`/`workspace` 贡献 → `panel` 贡献（文件树 left、工作区 main） |
| 3 | 外壳面板化 | `App.tsx` 重构：左栏（tab 切换）、主区（活动驱动 main 面板）、右栏、浮窗层 |
| 4 | FloatingPanel | 通用浮窗：标题栏拖拽、右下角缩放、关闭回停靠 |
| 5 | 侧栏浮窗化 | 双击 dock tab 浮起面板；浮窗关闭回 defaultDock |
| 6 | 审查 m1 | `## 助手` → 无 agentId（互逆） |

---

## 三、具体实现

### 文件清单与联系

| 文件 | 职责 |
|---|---|
| `ui-shell/src/panels.ts`（新） | 面板类型 + `queryPanels`（宿主视图剥 Contribution） |
| `ui-shell/src/components/FloatingPanel.tsx`（新） | 浮窗容器：拖拽/缩放/关闭（lucide X） |
| `ui-shell/src/App.tsx` | 面板化布局：`queryPanels` → left/right/main/floating 分层；`panelLazy` 缓存；float/dock/patchFloating；移除 Sidebar/RightBar/selectedPanelId |
| `ui-shell/src/index.css` | `.shell` relative；侧栏 flex column；`.panel-tabs/.panel-tab/.dock-panel/.floating-panel*` |
| `filesystem-driver/src/index.ts` | 迁移：`panel` "minex.filesystem.sidebar"（left）+ "minex.filesystem.workspace"（main） |
| `markdown-driver/src/index.ts` | 迁移：`panel` "minex.markdown.workspace"（main） |
| `session-driver/src/session.ts` + test | m1：`## 助手` 归一化 |

### 关键代码定位（file:line，供审查对照）

| 改动点 | 定位 |
|---|---|
| 面板类型 / 查询 | `ui-shell/src/panels.ts:14-33` |
| 浮窗拖拽/缩放 | `ui-shell/src/components/FloatingPanel.tsx:20-42` |
| 面板分层（left/right/main/floating） | `ui-shell/src/App.tsx:96-106` |
| lazy 面板缓存（稳定） | `ui-shell/src/App.tsx:109-115` |
| 浮起/停靠/patchFloating | `ui-shell/src/App.tsx:117-131` |
| 渲染停靠面板与浮窗层 | `ui-shell/src/App.tsx:163-232` |
| filesystem 面板注册 | `filesystem-driver/src/index.ts:15-31` |
| markdown 面板注册 | `markdown-driver/src/index.ts:87-94` |
| m1 归一化 | `session-driver/src/session.ts:225-229` |

### 关键设计

1. **面板 = 内容 + 默认停靠位**：驱动不再声明「我是侧栏还是工作区」，只贡献面板 + defaultDock；外壳决定停靠/浮起/（未来）多开——**无数量限制**。
2. **主区按活动驱动匹配**：`defaultDock === "main" && driverId === activeDriverId`，保留既有「活动驱动决定主区」语义。
3. **浮起/停靠**：浮起面板从 dock 移除进入浮窗层（`FloatingState`）；关闭 → 移除浮窗 → 自动回 defaultDock。
4. **lazy 稳定**：`panelLazy` Map 缓存（`lazy()` 必须稳定，避免每次渲染重挂载）。
5. **宿主视图 `.value`**：`queryPanels` 内 `.map(c => c.value)`（沿用历史坑规避）。
6. **驱动零耦合**：驱动注册面板用字面量对象，不 import 外壳类型。

---

## 四、审查标准

### 必须通过（已亲自验证，外部复核）

1. 三连全绿：`typecheck exit 0`（7 包）／`build exit 0`／`test 155/155`（18 文件）。
2. 左栏显示「文件」面板（文件树），tab 可切换（多 left 面板时）；双击 tab 浮起。
3. 主区按活动驱动显示面板（markdown 工作区 / 文件系统占位）；无活动驱动时空（无文字）。
4. 浮窗可拖拽移动、右下角缩放、关闭后回停靠。
5. 无旧 `sidebar/workspace` 贡献死引用（grep 无匹配）。

### 重点审查

- **P0 面板加载**：`panelLazy` 稳定性（无重挂载）；`queryPanels` 的 `.value` 剥壳。
- **P0 浮窗交互**：拖拽/缩放事件监听与卸载清理；position 更新不溢出（v1 无边界约束，接受）。
- **P1 迁移完整性**：filesystem/markdown 的旧贡献已移除，无其他消费方（grep 验证）。
- **P1 布局**：侧栏 flex column + dock-panel 滚动；`.panel-tabs` 不被 `.sidebar > *` padding 污染（`:not(.panel-tabs)`）。
- **P1 主区匹配**：活动驱动禁用时 main 面板消失、主体留空（既有语义保持）。

### 已知限制（勿误报）

- **工作视图多开（多实例切换）未做**——S4/后续阶段（用户已确认后置）。
- 浮窗位置/尺寸不持久化（刷新回默认 140,90,360,480）。
- 浮起交互入口为「双击 dock tab」+ title 提示（v1 无显式按钮）。
- 右栏当前无面板贡献（空）；左栏支持多面板 tab，右栏多面板并列堆叠。
- 浮窗无边界吸附/多屏约束；z-index 固定 50。
- 浮起的文件树仍可打开文件（事件流不变），markdown 主区正常响应。

---

**提交状态**：本轮改动独立提交：`feat(ui): S3 外壳面板化 + 浮窗（Panel 抽象 / FloatingPanel / 驱动迁移）+ 审查 m1`。
