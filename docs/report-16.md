# Minex 阶段报告 16（2026-08-13）—— 第二批：settingsView 机制 + appearance 重构

> 报告制度（固定四节）。前置：`docs/report-15.md`（第一批缺陷修复）。方案 A 已确认（驱动贡献 React 组件，惰性加载）。

---

## 一、本轮目标与预期

1. **驱动自定义设置视图机制（方案 A）**：驱动 `ctx.register("settingsView", driverId, { load })` 贡献惰性 React 组件；DriverDetail 有该贡献则渲染，否则默认「介绍/设置」结构。
2. **appearance 重构**：
   - 介绍（README.md 文档显示）
   - 管理主题（主题卡片网格 + 虚线框加号→市场占位）
   - 双击主题卡片 → 打开主题选项卡（右侧 × 关闭）
   - 主题全局设置：颜色（主题/背景/提示/警告）+ 字体（全局中文/英文）+ 图标体系
   - 下载主题只读（readOnly 标记 + 修改提示）
3. **字段收敛**：删 contentZhFont/contentEnFont/codeFont（代码块归 markdown 驱动）；warning/danger 替代 unfinished/error；字体收敛为 zhFont/enFont。

---

## 二、具体实现

### 文件清单与联系

| 文件 | 职责 |
|---|---|
| `packages/appearance-driver/src/settings-view.tsx`（新） | React 组件：介绍/管理主题选项卡 + 主题卡片 + 双击打开主题选项卡 + 主题全局设置表单（含字体预览） |
| `packages/appearance-driver/src/index.ts` | 注册 `settingsView`（惰性 `import("./settings-view.js")`）+ buildCss 新字段（zhFont/enFont/warning/danger） |
| `packages/appearance-driver/README.md`（新） | 介绍页显示的文档 |
| `packages/appearance-driver/src/vite-env.d.ts`（新） | `*?raw` 模块声明（README.md 作为字符串） |
| `packages/appearance-driver/package.json` | React peer/dev 依赖 |
| `packages/appearance-driver/tsconfig.json` | `jsx: react-jsx` |
| `packages/appearance-driver/manifest.json` | settingsSchema 收敛为 4颜色+2字体+1图标 |
| `packages/ui-shell/src/components/DriverDetail.tsx` | 消费 settingsView 贡献（lazy + Suspense），否则默认结构 |
| `packages/ui-shell/src/index.css` | 主题卡片网格/虚线加号/主题选项卡面板/readme 样式 |

### 数据流

```
DriverDetail(driverId)
  → registry.get("settingsView", driverId)
     有 → lazy(load()) + Suspense → <View kernel />
     无 → 默认 介绍/设置 结构

appearance SettingsView:
  介绍 tab ← import README.md?raw（Vite 打包为字符串）
  管理主题 tab ← storage.namespace("minex.appearance").get("themes")
      双击卡片 → openThemeIds 增加 → 渲染主题选项卡（可关闭）
      主题设置修改 → persistThemes → storage.set("themes") + emit minex:dataChanged
        → 驱动 apply() → buildCss(settings) → 重注册 theme → ThemeManager 重注入 CSS
```

### 关键设计

1. **惰性加载**：`settingsView` 贡献值是 `{ load }`，Node(CLI) 不调用 load → 不加载 React/tsx；浏览器 DriverDetail 才 lazy 加载。
2. **主题存储**：`storage.namespace("minex.appearance")`，`themes` 数组 + 默认主题；`activeThemeId` 标记当前激活。
3. **只读**：`Theme.readOnly` 标记下载主题，表单 disabled + 提示「需复制为新主题」。
4. **字段收敛**：全局设置 = 4 颜色 + 2 字体 + 1 图标；codeFont/customCss 移出（分别归 markdown 驱动 / 页面定制第三批）。

---

## 三、审查标准

### 必须通过

1. 构建/类型检查/测试全绿（验证 agent 执行；build-css 测试已适配新字段）。
2. 打开 appearance 详情 → 显示「介绍」（README 文本）+「管理主题」选项卡。
3. 管理主题：默认主题卡片 + 虚线框加号；双击默认主题 → 打开主题选项卡（× 可关）。
4. 主题选项卡：改主题色/字体 → 保存后界面颜色/字体即时变化（走 theme 重注册链路）。
5. CLI 加载 appearance 不崩（settingsView 惰性，Node 不加载 React）。

### 重点审查

- **P0 跨包 tsx**：ui-shell vite 构建能否解析 appearance 的 `settings-view.tsx`（动态 import "./settings-view.js" → .tsx）与 `README.md?raw`。
- **P0 惰性隔离**：appearance tsc 编译（jsx）后 dist 是否含 React import；CLI 加载 dist 是否触发（应不触发）。
- **P0 主题链路**：改主题设置 → data:changed → apply() → 重注册 theme → ThemeManager 重注入（无环）。
- **P1 只读**：readOnly 主题表单 disabled + 修改不写回。
- **P1 字体预览**：FontRow 下拉选项用自身字体渲染。

### 已知限制（勿误报）

- 主题商店/市场（虚线加号点击）未实现——占位。
- 缩放/动画/亚克力/背景图片/页面定制 CSS+HTML 属第三批。
- 「驱动设置」（其他驱动外观设置接入）待第二个驱动（markdown）落地。
- 修改只读主题后「不保存/覆盖/新建」三选一询问未实现（当前仅 disabled+提示）。
- 主题预览图（preview）暂无上传，卡片显示占位。
