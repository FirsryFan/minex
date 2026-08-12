# Minex 阶段报告 07（2026-08-12）—— ① 外壳重设计 v1

> 报告制度（固定四节）。本轮起：Designer 只写代码 + 文档，**不做构建/测试验证**，由外部验证 agent 扫描正确性。
> 前置：plugin → driver 全量改名已完成（`docs/driver-architecture.md` 定稿）。

---

## 一、上次（改名）结果

- 全量改名：内核 `DriverManifest/DriverContext/DriverModule/DriverState/loadDriversFromDir`、注册表 `driverId/unregisterByDriver`、`kernel.drivers`。
- 包/脚本/目录：`demo-plugin→demo-driver`、`sync-plugins.mjs→sync-drivers.mjs`、`plugins/→drivers/`、`plugins:sync→drivers:sync`。
- 修正 sed 误伤：`@vitejs/plugin-react` 包名、vite `plugins` 配置键。
- 验证（外部 agent 复核）：73 测试全绿、CLI 冒烟通。

---

## 二、本轮目标与预期功能（① 外壳重设计 v1）

按 `docs/driver-architecture.md` 第七节构建顺序的 ①（外壳重设计），**v1 范围**：

1. **顶栏**：左 = 驱动选择器（下拉、滚动式、支持搜索、显示图标+名；选中后按钮旁显示当前驱动图标+名）+ 右 = 深浅色切换 + 设置按钮。**项目名 Minex 不再出现在左上角**。
2. **App 视图切换**：`workspace`（顶栏 + 工作区）↔ `settings`（主设置页，全屏、无顶栏）。
3. **主题系统基础**：`theme.css` 定义浅色令牌 + `[data-theme="dark"]` 覆盖块；切换按钮读写 `document.documentElement.dataset.theme`，localStorage 持久化。
4. **主设置页 v1**：左栏文件夹式导航（「驱动设置」→ 下载/管理/总览），主体为「驱动管理」列表（搜索栏 + 表格：驱动名/版本左对齐、启用开关右对齐 + 全部启用/全部禁用按钮）。
5. **工作区**：保留现有通用结构（Sidebar/Main/RightBar）作为**默认工作区**；驱动工作区贡献（`driver/workspace`）留待后续。

**明确不在本轮**：命令面板（`/` 指令）、驱动详情页选项卡、驱动下载界面、侧栏面板系统（可切换位置/隐藏）。

---

## 三、具体实现

### 文件清单与联系

| 文件 | 职责 | 连接 |
|---|---|---|
| `packages/kernel/src/types.ts` | `DriverManifest` 加 `icon?: string` | 全局 |
| `packages/kernel/src/manifest.ts` | `parseManifest` 解析 `icon` | 被 loader/驱动调用 |
| `packages/demo-driver/manifest.json` | 加 `"icon": "🧪"` | 演示驱动图标 |
| `packages/ui-shell/src/theme.css` | 浅色令牌 + `[data-theme="dark"]` 覆盖块 | 全局 |
| `packages/ui-shell/src/index.css` | 顶栏布局（选择器按钮/下拉菜单/搜索框）、设置页、文件夹树样式 | 结构 |
| `packages/ui-shell/src/components/TopBar.tsx` | 驱动选择器 + 主题切换 + 设置按钮 | 读 kernel.drivers |
| `packages/ui-shell/src/components/DriverSelector.tsx` | 下拉菜单（搜索 + 滚动列表 + 图标名） | 调 onSelect |
| `packages/ui-shell/src/components/ThemeToggle.tsx` | 深浅切换（太阳/月亮） | 读写 data-theme + localStorage |
| `packages/ui-shell/src/components/SettingsPage.tsx` | 全屏设置页：左栏文件夹树 + 主体（驱动管理） | 读 kernel.drivers/registry |
| `packages/ui-shell/src/App.tsx` | 视图切换 + 活动驱动状态 + 主题状态 | 组合 |

### 数据流

```
App: view = workspace | settings；activeDriverId（localStorage）；theme（localStorage）
├─ view=workspace：TopBar（DriverSelector→setActiveDriver / ThemeToggle→setTheme / 设置按钮→setView(settings)）+ 默认工作区（Sidebar/Main/RightBar）
└─ view=settings：SettingsPage（左栏树选择 → 主体驱动管理；启用开关→kernel.drivers.activate/deactivate）
```

### 关键设计决策

1. **主题 = CSS 变量切换**：浅色在 `:root`，深色在 `[data-theme="dark"]` 覆盖；组件全部用 `var()`。切换只改 `dataset.theme`——换肤零重渲染成本。
2. **活动驱动持久化**：localStorage key `minex.activeDriver`；v1 只有 demo 驱动，选择器列出所有已激活驱动。
3. **设置页 = 独立全屏视图**：不走路由库，App 内 `view` 状态切换。设置页无顶栏（符合规格）。
4. **启用/禁用 = activate/deactivate**：驱动管理表直接调 `kernel.drivers.activate/deactivate`（已实现的 lifecycle，含容错）。

---

## 四、审查标准

### 必须通过

1. 代码能构建、类型检查、测试通过（验证 agent 执行，本轮未自验）。
2. 顶栏：左上角是驱动选择器（无 Minex 字样），选中后显示驱动图标+名；右侧有主题切换 + 设置。
3. 主题切换：点太阳/月亮 → 界面深浅切换；刷新后保持（localStorage）；`[data-theme="dark"]` 覆盖生效。
4. 设置页：点设置按钮 → 全屏设置页（无顶栏）；左栏「驱动设置」文件夹展开出 下载/管理/总览；「驱动管理」显示表格 + 全部启用/全部禁用。
5. 驱动管理：启用开关调用 activate/deactivate，状态反映在表格。

### 重点审查

- **P0 主题**：`[data-theme="dark"]` 覆盖是否完整（有没有遗漏硬编码色）；切换是否持久化；初始读取。
- **P0 DriverSelector**：下拉开合逻辑、搜索过滤、点外部关闭、Esc 关闭。
- **P0 设置页路由**：view 切换后旧视图状态清理；返回工作区。
- **P1 启用/禁用**：表格状态与 `kernel.drivers.getState` 是否同步；事件刷新是否触发重渲染。
- **P1 空状态**：无驱动/无设置项时的显示。

### 已知限制（勿误报）

- 驱动工作区贡献（`driver/workspace`）未实现——工作区是默认通用结构。
- 命令面板（`/`）、驱动详情选项卡、驱动下载、侧栏面板系统（切换位置/隐藏）未在本轮。
- 驱动图标用 emoji 字符串（`manifest.icon`），非图片。
