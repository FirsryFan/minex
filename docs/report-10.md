# Minex 阶段报告 10（2026-08-12）—— 启用/禁用重构 + 主题贡献机制 + 外观驱动

> 报告制度（固定四节）。本轮综合三块：学员报告的启用/禁用问题 + 主题贡献机制（为外观驱动铺路）+ 外观驱动（第一个真实驱动）。

---

## 一、上次问题的处理结果

学员报告：驱动管理「禁用后按钮变启用，启用后不立即变禁用」。根因：启用走 `reload`（异步激活），依赖 onChange 事件触发重渲染，路径与禁用（deactivate → onChange）不对称且不可靠。

**处理**：改为**暂存式**模型（学生建议的方案），从根上消除「立即生效」的不对称：
- 点击启用/禁用只**标记待变更**（React 状态，同步反映），不立即应用；
- 点「重新加载」统一应用所有待变更（应用后 `onApplied` 强制刷新）；
- **禁用被已激活驱动依赖的驱动 → 弹确认警告**；
- 应用逻辑对称：`applyDriverState(id, enabled)` —— 启用（deactivated→reload / discovered→activate）、禁用（activated→deactivate），逐驱动容错。

---

## 二、本轮目标与预期功能

1. **驱动管理暂存式**（见一）：依赖警告 + 对称应用 + 待变更徽标。
2. **主题贡献机制**：驱动贡献 `theme`（CSS 覆盖块），外壳 `ThemeManager` 注入 `<style>`；模式（深/浅）状态提升到 App 共享。
3. **外观驱动（第一个真实驱动）**：条目式设置（主题色 + 三种字体），生成浅/深两份 theme CSS 贡献；设置保存后重注册，外壳随即重应用。

---

## 三、具体实现

### 文件清单与联系

| 文件 | 职责 |
|---|---|
| `packages/ui-shell/src/components/SettingsPage.tsx` | ManageView 暂存式（pending + 确认框 + 对称 apply）；`applyDriverState` |
| `packages/ui-shell/src/components/ThemeManager.tsx`（新） | 消费 `theme` 贡献，注入 `<style id="minex-driver-theme">`；订阅 theme onChange |
| `packages/ui-shell/src/App.tsx` | `dark` 状态提升（localStorage + dataset.theme）；渲染 ThemeManager；ThemeToggle props 化 |
| `packages/ui-shell/src/components/ThemeToggle.tsx` | 改 props 驱动（dark/onToggle） |
| `packages/ui-shell/src/components/TopBar.tsx` | 透传 dark/onToggleTheme |
| `packages/ui-shell/src/theme.css` | +`--font-ui/--font-content/--font-code` 令牌 |
| `packages/ui-shell/src/index.css` | body 用 `--font-ui`、code 用 `--font-code`；+pending-badge/btn-primary/confirm-box |
| `packages/ui-shell/src/drivers.ts` | 加入 appearance-driver |
| `packages/appearance-driver/**`（新包） | manifest（settingsSchema）/src/index.ts（buildCss + 注册 theme + 订阅 data:changed）/icon.svg |
| `scripts/sync-drivers.mjs` | 改为扫描 packages/* 所有驱动包 |

### 数据流

```
外观驱动 activate:
  settings = storage.get("config")
  register("theme", "minex.appearance.light", { mode:"light", css: buildCss("light", settings) })
  register("theme", "minex.appearance.dark",  { mode:"dark",  css: buildCss("dark",  settings) })
  on("minex:dataChanged") → apply() 重注册（设置保存后）

外壳 ThemeManager:
  mode = dark ? "dark" : "light"
  themes = registry.query("theme").filter(mode 匹配)
  <style id="minex-driver-theme"> = themes.map(css).join  → 注入 head（在 theme.css 之后，同特异性后胜）

驱动管理暂存式:
  点击 → mark(pending)（禁用+依赖 → ConfirmModal 确认）
  「重新加载」→ applyAll：Object.entries(pending) → applyDriverState → 清 pending → onApplied 刷新
```

### 关键设计决策

1. **暂存式**：变更不立即生效，统一「重新加载」应用——与「驱动变更需重载生效」的语义一致，也绕开了即时应用的状态刷新竞态。
2. **主题贡献 = CSS 覆盖块**：驱动贡献 `{ mode, css }`，外壳注入。系统默认（theme.css 浅 + [data-theme=dark] 深）在注入之前 → 驱动覆盖默认。同一机制未来可容纳「下载的主题」。
3. **外观驱动双主题**：浅 `:root` / 深 `[data-theme="dark"]` 各一份，从同一设置生成。设置保存（data:changed）→ 驱动重注册 → ThemeManager 重应用。
4. **依赖警告**：`dependents(id)` = 已激活且依赖该驱动的驱动；禁用时弹确认。

---

## 四、审查标准

### 必须通过

1. 构建/类型检查/测试全绿（验证 agent 执行；本轮无新增自动化测试——纯 UI + 新驱动包）。
2. 驱动管理：点击启用/禁用 → 显示「待启用/待禁用」徽标 + 按钮高亮，**不立即生效**；点「重新加载」统一应用；应用后按钮状态更新。
3. 依赖警告：禁用被依赖的驱动 → 弹确认框；确认才标记。
4. 主题：改外观驱动设置（如主题色）→ 保存 → 界面颜色跟随变化；深/浅模式各自用对应 theme。
5. 图标：两个驱动（demo/appearance）在顶栏选择器/驱动管理显示图片图标。

### 重点审查

- **P0 暂存式状态机**：pending 的 set/撤销/清空；toggle 对 pending 的撤销逻辑；apply 顺序（禁用依赖驱动后其依赖者状态）；reloadable:false 驱动的启用失败容错。
- **P0 ThemeManager**：CSS 注入/移除（无 theme 贡献时 `<style>` 为空）；mode 切换重应用；注册表 onChange 订阅清理。
- **P1 外观驱动**：buildCss 的 `:root`/`[data-theme]` 选择器与 theme.css 的覆盖关系；`data:changed` 重注册是否会无限循环（apply 内 register → onChange → ThemeManager 重应用，但驱动自身不再触发 apply——确认无环）。
- **P1 sync-drivers**：扫描 packages/* 是否会误同步 kernel/cli/ui-shell（它们无 manifest.json → 跳过）。

### 已知限制（勿误报）

- 外观驱动 v1 只有条目式设置（主题色/字体），CSS 代码编辑留待后续（选项卡「设置」届时加 textarea）。
- 设置保存后主题即时生效，但**驱动状态变更（启用/禁用）仍需「重新加载」**——这是设计语义，非缺陷。
- 驱动详情页「下载/总览」仍未实现。
