# Minex 阶段报告 12（2026-08-12）—— 12 条 UI 细节反馈处理

> 报告制度（固定四节）。学员 12 条细节反馈，逐条处理：完成 / 部分 / 延后（学员已明示部分「不需要现在设计」）。

---

## 一、12 条反馈处理状态

| # | 反馈 | 状态 | 实现 |
|---|---|---|---|
| 1 | 驱动介绍：名字/版本/来源/最小内核/状态/简介在条上方；大图居左固定大小 | ✅ | `DriverDetail` 头部（大图标 72px + 右侧介绍）；`DriverManifest` 加 `source`/`description` |
| 2 | 折叠设计 + 突然滚动条 | ⏸ 延后（学员：不需要现在设计） | —— |
| 3 | 左右栏可拖动调整宽度 + 最小宽度；主体最小宽度 | ⏸ 延后 | —— |
| 4 | 无主界面的驱动不显示在左上角功能区 | ✅ | `DriverManifest.hasWorkspace`；App 选择器过滤；demo/appearance 无 → 不出现在选择器 |
| 5 | appearance 代码设置（CSS 编辑）未上线 | ✅ | SettingsForm 支持 `textarea` 类型；appearance 加 `customCss` 字段，buildCss 追加 |
| 6 | 打开驱动设置时点左栏条目应更新画面 | ✅ | 设置页左栏导航点击 → `setSelectedDriverId(null)` |
| 7 | 切换画面保持未保存状态 + 未完成黄色标记 | ◐ 部分 | **自动保存**已实现（SettingsForm v2 每次修改即写入 storage + data:changed）；「未完成」黄色标记系统（含父级目录路径高亮）**延后** |
| 8 | 设置界面分组逻辑（颜色/字体/UI图标/代码块） | ✅ | SettingsForm v2 支持 `schema.groups` 分组渲染；appearance 分 4 组 |
| 9 | 主题色按钮问题（中性底 + 悬停主题色 + 选中框线） | ✅ | `.btn` 中性（--color-text/--color-bg），悬停主题色；active 态改主题框线（inset box-shadow） |
| 10 | 字体中英文独立 + 搜索下拉 + 代码字体单独 | ✅ | appearance 字体 5 字段（uiEn/uiZh/contentEn/contentZh/code）；SettingsForm 支持 `enum` → 带搜索下拉 |
| 11 | 圆角/框线：主设置/深浅/左右栏/顶栏无框线；折叠按钮只留图标 | ✅ | 去掉 topbar/sidebar/rightbar 边框；`.btn-ghost`/`.icon-btn` 无边框；折叠按钮纯图标 |
| 12 | demo panel 不能点出去 | ⏸ 延后（学员：可能整个删掉） | —— |

---

## 二、本轮实现

### 文件清单

| 文件 | 变更 |
|---|---|
| `packages/kernel/src/types.ts` | `DriverManifest` + `hasWorkspace`/`source`/`description` |
| `packages/kernel/src/manifest.ts` | 校验 + 解析三个新字段 |
| `packages/demo-driver/manifest.json` | +source/description |
| `packages/appearance-driver/manifest.json` | +source/description；settingsSchema 重构为 4 组（颜色/字体/图标/代码块），含 color/enum/textarea 类型 |
| `packages/appearance-driver/src/index.ts` | buildCss 支持背景色/提示色/中英字体/自定义 CSS |
| `packages/ui-shell/src/App.tsx` | 驱动选择器过滤 `hasWorkspace` |
| `packages/ui-shell/src/components/SettingsForm.tsx` | v2：分组 + color/textarea/enum(带搜索下拉) + **自动保存** |
| `packages/ui-shell/src/components/DriverDetail.tsx` | 头部：大图标 + 来源/最小内核/状态/简介 |
| `packages/ui-shell/src/components/SettingsPage.tsx` | 左栏导航清除驱动详情（点6） |
| `packages/ui-shell/src/theme.css` | +`--color-unfinished`/`--color-error` 提示色令牌 |
| `packages/ui-shell/src/index.css` | 按钮中性+主题悬停；去 topbar/sidebar/rightbar 边框；active 态主题框线；driver-header/select-btn/textarea/color 样式 |

### 关键设计

1. **SettingsForm 自动保存**：每次修改即写 storage（基于最新 config 合并）+ 发 `minex:dataChanged` → 驱动重注册 / ThemeManager 重应用。切走再切回从 storage 重读，不丢。
2. **设置分组**：`schema.groups: [{ title, properties }]`，渲染为多张卡片；兼容无分组的 `properties`。
3. **字体下拉**：`enum` 字段 → 带搜索的下拉（Select 组件，复用 driver-selector/dropdown 样式）。
4. **主题色语义**：`.btn` 用 `--color-text`/`--color-bg`（随深浅自动中性），hover 换 `--color-primary`；选中用 inset 框线。

---

## 三、审查标准

### 必须通过

1. 构建/类型检查/测试全绿（验证 agent 执行）。
2. 学员逐条验收（一表 ✅ 项）。
3. 设置页改主题色/字体 → 保存 → 即时生效（前轮修复不回退）。

### 重点审查

- **P0 SettingsForm 自动保存**：写入/重读一致性；`enum` 下拉选择后值写入；color 输入格式。
- **P0 appearance buildCss**：新字段（背景/提示色/中英字体/customCss）生成合法 CSS；浅/深双主题。
- **P1 驱动选择器**：hasWorkspace 过滤后为空选择器的表现（当前无驱动有 workspace，选择器应显示「无」或隐藏）。
- **P1 CSS 语义**：`.btn` 中性底在深浅模式下对比度；active 框线可见性。

### 已知限制（勿误报）

- 延后项：#2 折叠设计、#3 可拖拽宽度、#7 未完成标记系统、#12 demo panel 点出。
- 提示色（未完成/报错）已定义为 token 并可由外观驱动覆盖，但 UI 尚未用它们（#7 延后）。
- 图标体系下拉（iconTheme）只存储值，尚未驱动图标渲染。
