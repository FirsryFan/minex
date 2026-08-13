# Minex 阶段报告 15（2026-08-13）—— 第一批：已有 UI 缺陷修复

> 报告制度（固定四节）。学员 6 条问题 + appearance 完整需求，分三批：第一批修已有缺陷（本轮），第二批 appearance 重构，第三批市场/缩放/动画等大功能。

---

## 一、本轮（第一批）修改结果

| # | 问题 | 修复 | 代码定位 |
|---|---|---|---|
| 1 | 拖动放大（鼠标移一点栏位移很多） | Resizer 以**按下时宽度为基准**（`base = initialWidth`），move 传绝对目标值 `base ± dx`，而非累计位移叠加 | `packages/ui-shell/src/App.tsx` Resizer |
| 2 | 主体颜色层级（直角深色内浅色圆角） | 主体 `.main` 用 `--color-bg`（背景层），非独立浅色；`--color-bars`/`--color-main` 变量删除 | `index.css` + `theme.css` |
| 3 | 表单简洁大气（label 左/输入右 + 驼峰转空格 + color 无框线） | `.field` 改 flex 横排（label 140px 固定）；`humanize()` 驼峰转空格；color 去框线 | `SettingsForm.tsx` + `index.css` |
| 4 | 字体预览 + 字体不全 | 新增 `font` 字段类型 → 下拉选项用**自身字体渲染预览**；字体列表扩充（英 29 / 中 17 / 代码 12） | `SettingsForm.tsx` + `appearance-driver/manifest.json` |
| 5 | 背景色逻辑（背景是所有底色，文字在其上） | 顶/左/右栏/主区统一 `--color-bg`（背景层），卡片/浮窗用 `--color-card`（表面层） | `index.css` + `theme.css` |

---

## 二、本批目标与预期

- 修 5 条 UI 缺陷（拖动/层级/表单/字体/背景）。
- 背景层级语义确立：**背景层（bg）= 所有底色，文字/图标浮于其上；表面层（card）= 卡片**。

---

## 三、实现要点

1. **Resizer 基准**：`onResize(targetWidth)` 改绝对语义；左栏 `base + dx`、右栏 `base - dx`。
2. **背景分层**：删除 `--color-bars`/`--color-main`，`.topbar/.sidebar/.rightbar/.main` 全用 `--color-bg`；`.main-strip` 透明；`.floating`/`.card` 用 `--color-card`。
3. **humanize**：`primaryColor` → `primary color`（正则 `([a-z0-9])([A-Z])`）。
4. **font 类型**：`SchemaProp.type: "font"` → `Select preview`，选项 `fontFamily` 渲染 + "Preview 字体预览" 示例。

---

## 四、审查标准

### 必须通过

1. 构建/类型检查/测试全绿（验证 agent 执行）。
2. **拖动**：拖左栏把手，栏宽跟随鼠标 1:1（不放大）。
3. **背景**：深色模式下主体是圆角深色区域，非「深色底内浅色圆角」；左/右/顶/主区同背景色，文字浮其上。
4. **表单**：`primaryColor` 显示为「primary color」；label 左、输入右；颜色选择器无框线。
5. **字体**：字体下拉每项用自身字体渲染预览；含空格字体名有效（W2 不回退）。

### 重点审查

- **P0 Resizer**：`base` 闭包是否正确捕获按下时宽度（React 重新渲染后 base 不更新——应为按下时快照，符合预期）。
- **P0 背景层级**：深色模式 `--color-bg`/`--color-card` 对比度；卡片边框是否清晰区分表面层。
- **P1 humanize**：多驼峰（`uiEnFont` → "ui en font"）与首字母大写边界。
- **P1 font 预览**：空 fontFamily 的 fallback；下拉项预览文本是否撑爆宽度。

### 已知限制（勿误报）

- 「电脑所有字体」需 Electron 原生枚举（浏览器沙箱无法完整枚举），v1 用扩充列表 + 预览；Electron 版落地时接 `font-list`。
- appearance 完整重构（介绍/管理主题/主题卡片/主题商店）属第二批，未在本轮。
