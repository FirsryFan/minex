# Minex 阶段报告 17（2026-08-13）—— 6 条反馈修复

> 报告制度（固定四节）。学员 6 条反馈，逐条处理。

---

## 一、修改结果

| # | 反馈 | 修复 | 代码定位 |
|---|---|---|---|
| 1 | 背景色仍严重（只处理了例子） | **根因定位**：① `--color-unfinished/--color-error` 与 appearance 的 `--color-warning/--color-danger` 变量名不一致；② `--color-card`（表面色）不随背景色联动。修复：buildCss 的 backgroundColor **派生** `--color-card`（92% bg + white）与 `--color-hover`（96% bg + white）；变量名统一 | `appearance-driver/src/index.ts` buildCss + `theme.css`/`index.css` |
| 2 | 初始浅色+初始深色两个主题 + 默认选择 | 默认主题拆为「默认浅色(light)/默认深色(dark)」两个；apply() 浅/深各取对应 mode 主题的 settings | `settings-view.tsx` DEFAULT_THEMES + `index.ts` apply |
| 3 | 字体未全局一致（图标下拉等） | 根因：表单元素默认不继承 body 字体。加 `input/select/textarea/button { font-family: inherit }` | `index.css` |
| 4 | 冗余说明文字 | 删「预览 Preview」「（空槽位）」「（默认）」；RightBar 清空 | `settings-view.tsx`/`SettingsForm.tsx`/`RightBar.tsx` |
| 5 | 设置界面切换 bug（共用对象）+ 双击原地显示 | **重构为真选项卡系统**：介绍/管理主题/主题选项卡并列（activeTab 状态），双击打开新选项卡（可关闭 ×），切换互不干扰 | `settings-view.tsx` 全重构 |
| 6 | 卡片/按钮无反馈 + 颜色点一下弹取色器 | ① hover 反馈：`.btn/.icon-btn` 上弹 translateY(-1px)，`.theme-card` 上弹 -2px + 阴影，列表项 hover 变亮；② 颜色改**自定义滑块拖动**（R/G/B 三滑块，非系统取色器） | `index.css` + `settings-view.tsx` ColorField |

---

## 二、关键设计

1. **背景色联动**：backgroundColor 一处设置，`--color-bg`/`--color-card`/`--color-hover` 三变量联动（card/hover 用 color-mix 从 bg 派生，都比 bg 更亮）。
2. **真选项卡**：`tabs: Tab[]`（含 closable），`activeTab` 决定渲染哪块——介绍与主题设置不再共享状态。
3. **颜色滑块**：ColorField 用 3 个 `<input type=range>`（R/G/B）+ 色块，拖动实时预览，不弹系统取色器。

---

## 三、审查标准

### 必须通过

1. 构建/类型检查/测试全绿（build-css 新增 backgroundColor 派生用例）。
2. **背景联动**：改「默认浅色」背景色 → 卡片/悬停色随之变（非仅背景变）。
3. **双主题**：管理主题显示「默认浅色」「默认深色」两个卡片；切深色用深色主题设置、切浅色用浅色主题。
4. **选项卡**：双击主题 → 打开新选项卡（× 可关）；切到「介绍」后主题设置**不残留**（真隔离）。
5. **字体**：图标体系下拉、颜色滑块等所有文字随全局字体变化。
6. **交互**：卡片/按钮 hover 上弹/变亮；颜色滑块可拖动。

### 重点审查

- **P0 选项卡隔离**：closeTab 后 activeTab 回退逻辑（关闭当前激活 tab）；同主题重复双击去重。
- **P0 背景派生**：`color-mix` 的 card/hover 在深/浅背景下的对比度；旧浏览器 fallback。
- **P1 双主题**：apply() 找不到 mode 对应主题时（themes 为空）的兜底。
- **P1 颜色滑块**：R/G/B 独立拖动后 hex 拼接正确性（parseInt padStart）；disabled 只读主题。

### 已知限制（勿误报）

- 「默认浅色/深色主题」的**指定**（哪个主题是默认）未做选择 UI——当前固定 default-light/default-dark，两个主题可直接编辑。
- 主题预览图（preview 上传）未实现，卡片用「浅色/深色」占位。
- 主题商店/缩放/动画/亚克力/背景图片/页面定制 属第三批。
