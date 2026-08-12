# Minex 阶段报告 11（2026-08-12）—— 阶段 10 检阅修复 + 主题生效真 bug

> 报告制度（固定四节）。前置：`docs/report-10.md` → `docs/review-phase10-report.md`。
> 学员手动测试发现真 bug：**修改主题色无变化、字体无效果**——检阅把根因（T1）降为 MINOR，实际是用户可见的阻塞。

---

## 一、问题处理结果

### 学员真 bug（主题色/字体不生效）——根因 T1

**诊断**：内核层完全正常（node 实测：外观驱动注册 theme、`data:changed` 重注册均工作）。UI 层问题：
- `ThemeManager` 只在 workspace 视图渲染（App 对 settings 视图提前 return）→ **设置页内改主题色 → 驱动重注册 → ThemeManager 未挂载 → 不重应用**；返回 workspace 才可能生效。
- 且设置页期间 `<style id="minex-driver-theme">` 残留旧 CSS（组件卸载不清除 style 元素）。

**修复**：`ThemeManager` 改为 **App 两种视图都挂载**（Fragment 包裹 settings 分支）→ 设置页改主题即时生效。

### 检阅项处理

| # | 问题 | 处理 |
|---|---|---|
| T0 | storage-local 测试基建 bug（fake `length:0` 静态非 getter） | 改 `get length() { return map.size; }` → 基线恢复 |
| S1 | applyAll 依赖顺序 + 失败静默 | 先启用（依赖先于依赖者）后禁用（依赖者先于依赖）；`applyDriverState` 返回 boolean；**失败项保留在 pending 并 console 汇报**，不再吞错清空 |
| S2 | setAll 绕过依赖警告 | 「全部禁用」若涉及被依赖驱动 → 弹确认 |
| S3 | applyDriverState 吞错 | 与 S1 合并：失败项保留 + 汇报 |
| S4 | 依赖警告只查直接依赖 | `dependents` 现在也计入 **待启用** 的依赖者 |
| T2 | ThemeManager effect 依赖 themes 数组每次渲染重跑 | 改依赖 `[kernel, dark, tick]`（tick 由 theme onChange 触发） |
| I1 | DriverIcon 相对路径不识别 | isImage 增加 `./`、`.svg`、`.png` 判定 |
| S5 | pending 不持久 | 已知限制（v1 接受，切换视图丢失待变更） |

**检阅的「明显错误」**：把 T1 标为 MINOR（「设置页内驱动主题贡献不应用」）——这正是学员手动测试命中的阻塞 bug，应至少 MAJOR。检阅漏判根因。

---

## 二、本轮目标与预期功能

1. 修复主题色/字体不生效（T1 常驻挂载）。
2. 基线恢复绿（T0）。
3. 暂存式应用健壮性（S1/S2/S3/S4）。
4. ThemeManager 性能（T2）、图标相对路径（I1）。

---

## 三、具体实现

| 文件 | 变更 |
|---|---|
| `packages/ui-shell/src/App.tsx` | ThemeManager 常驻（settings 分支 Fragment 包裹） |
| `packages/ui-shell/src/components/ThemeManager.tsx` | effect 依赖改 `[kernel, dark, tick]`（T2） |
| `packages/ui-shell/src/components/SettingsPage.tsx` | confirm 状态重构（单/批量共用）；setAll 警告（S2）；applyAll 先启用后禁用+保留失败（S1/S3）；dependents 含待启用（S4）；applyDriverState 返回 boolean |
| `packages/ui-shell/test/storage-local.test.ts` | fake localStorage `length` 改 getter（T0） |
| `packages/ui-shell/src/components/DriverIcon.tsx` | 相对路径/后缀图标识别（I1） |

---

## 四、审查标准

### 必须通过

1. 构建/类型检查/测试全绿（T0 修复后 baseline 恢复；验证 agent 执行）。
2. **学员验收**：`npm run ui` → 设置页 → 外观驱动「…」→ 设置 → 改主题色/字体 → 保存 → **设置页界面即时变色/变字体**。
3. 驱动管理：禁用被依赖驱动 → 弹确认；「全部禁用」涉及被依赖 → 弹确认；应用失败项保留并汇报。

### 重点审查

- **P0 主题生效链路**：`data:changed` → 驱动重注册 → registry.onChange("theme") → ThemeManager tick → 重注入；`<style id="minex-driver-theme">` 是否在 theme.css 之后（后胜）。
- **P0 applyAll 顺序**：先启用后禁用的合理性；失败项保留逻辑（pending 不因失败清空）。
- **P1 confirm 状态**：单驱动禁用 vs 全部禁用批量的确认合并；取消不清空已有 pending。
- **P1 dependents**：含待启用的判定（`pending[d.manifest.id] === true`）是否造成误报。

### 已知限制（勿误报）

- S5 pending 不持久（切视图丢失）——v1 接受。
- 外观驱动仅条目式设置；CSS 代码编辑留待后续。
- 传递依赖警告（Z→Y→X 禁用 X）仍只查直接依赖——S4 部分解决（直接依赖 + 待启用），完整传递闭包留待后续。
