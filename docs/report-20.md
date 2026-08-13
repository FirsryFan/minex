# Minex 阶段报告 20（2026-08-13）—— 扩展标签 + 全局设置 + markdown 全套设置 + 渲染器增强

> 报告制度（固定四节）。覆盖连续多轮：扩展标签、appearance 全局设置、markdown 设置（文档字体/缩放/代码块/KaTeX）、渲染器增强（highlight.js + KaTeX）、快捷键、即时渲染。
> 前置：`docs/report-19.md` → `docs/review-phase19-report.md`（B1 已修复）。

---

## 一、上次问题（report-19 B1）回归

B1（DriverSettingsSection 漏 `.value`）已修复：`query(...).map(c => c.value)`，typecheck 恢复 + 消除运行时崩溃。已记入长期记忆（宿主视图 vs 受限视图 API 差异）。

---

## 二、本轮目标与内容

| # | 内容 | 定位 |
|---|---|---|
| 1 | 扩展标签 | `DriverManifest.tags/kind` + 校验解析 + DriverHeader 显示 `.driver-tag` |
| 2 | appearance 全局设置 | `buildGlobalCss`（缩放/动画开关/亚克力/背景图）+ global theme 贡献 + 设置表单 |
| 3 | markdown 文档字体/缩放/代码块 | `buildMarkdownCss`（--font-md/--md-font-size/--font-code/--md-code-wrap）+ index.css 接入 |
| 4 | 渲染器增强 | `renderMarkdown(md, opts)`：highlight.js 代码高亮 + marked-katex-extension 公式 |
| 5 | 快捷键 | `shortcuts.ts` 纯函数（applyFormat + shortcutToAction）+ textarea keydown |
| 6 | 即时渲染 | wysiwyg 模式（contentEditable + turndown 双向转换） |

---

## 三、具体实现

### 文件清单与联系

| 文件 | 职责 |
|---|---|
| `packages/kernel/src/types.ts` + `manifest.ts` | `tags: string[]` / `kind: string` 字段 + 校验 |
| `packages/ui-shell/src/components/DriverDetail.tsx` | DriverHeader 显示 tags |
| `packages/appearance-driver/src/index.ts` | `buildGlobalCss` 纯函数 + apply 注册 global theme |
| `packages/appearance-driver/src/settings-view.tsx` | 全局设置 section（缩放/动画/亚克力/背景图） |
| `packages/markdown-driver/src/markdown.ts` | `renderMarkdown(md, opts)`：Marked 实例 + highlight.js + katex |
| `packages/markdown-driver/src/index.ts` | `buildMarkdownCss` 纯函数 + applyCss |
| `packages/markdown-driver/src/shortcuts.ts` | 快捷键纯函数 |
| `packages/markdown-driver/src/workspace-view.tsx` | 四模式（编辑/预览/分屏/即时）+ keydown + contentEditable |
| `packages/markdown-driver/src/settings-view.tsx` | 文档字体/缩放/代码块/高亮/KaTeX 设置 |

### 数据流

```
设置修改 → storage.set + emit("minex:dataChanged")
  → appearance apply() → buildCss(mode) + buildGlobalCss → 重注册 theme
  → markdown applyCss() → buildMarkdownCss → 重注册 theme
  → ThemeManager onChange("theme") → 重注入 <style>

markdown 渲染：renderMarkdown(doc, {codeHighlight, katex}) → HTML
  即时模式：HTML → contentEditable 编辑 → turndown → markdown 存回 doc
```

### 关键设计

1. **渲染器 = 配置化纯函数**：`renderMarkdown(文本, 选项) → HTML`，用 `Marked` 实例（非全局单例）避免多次调用累积。
2. **即时渲染双向一致**：markdown ↔ HTML（marked 渲染 + turndown 转回），文档始终是 markdown 源码。
3. **快捷键纯函数**：`applyFormat(doc, start, end, action)` 返回 `{text, selectionStart, selectionEnd}`，可测。
4. **global theme 贡献**：`mode` 缺省 → ThemeManager 两种模式都注入（缩放/动画/亚克力/背景图与深浅无关）。

---

## 四、审查标准

### 必须通过

1. `npm run typecheck && npm run build && npm test` 三连全绿（验证 agent 执行；新增 shortcuts 9 + markdown 高亮/KaTeX 2 + buildGlobalCss 3 + buildMarkdownCss 3）。
2. 驱动详情显示标签徽标；顶栏只列 markdown。
3. markdown 四模式切换；快捷键（Ctrl+B/I/1-6 等）在编辑区生效；即时模式可编辑渲染结果且切回源码是 markdown。
4. appearance 全局设置（缩放/动画/亚克力/背景图）即时生效。
5. markdown 设置（文档字体/缩放/代码块字体/换行/高亮/KaTeX）即时生效。

### 重点审查

- **P0 渲染器**：`marked.use` 的 renderer.code 覆盖签名（marked v12）；`marked-katex-extension` 的 import/用法；高亮 fallback（无语言返回 false）。
- **P0 即时渲染**：contentEditable 非受控 + 仅进入模式时同步 innerHTML（避免光标重置）；turndown 转回的 markdown 精度；`useEffect` 依赖（mode 而非 html）。
- **P0 快捷键**：`applyFormat` 的选区计算（行内 vs 行级）；`shortcutToAction` 的 Cmd/Ctrl 兼容；`requestAnimationFrame` 恢复选区。
- **P1 CSS 变量**：`--font-md/--md-font-size/--md-code-wrap` 的 fallback 值；highlight.js/katex CSS 的引入位置（workspace-view 惰性加载，Node 不触发）。
- **P1 依赖**：新增 highlight.js/katex/turndown/marked-katex-extension 是否在 markdown-driver 正确声明。

### 已知限制（勿误报）

- 即时渲染是「进入时渲染、编辑转回 markdown」的简化版，非 Typora 完整 inline editing（光标处显示源码标记）——完整版需 ProseMirror/CodeMirror WYSIWYG。
- 即时模式编辑后切回源码，markdown 由 turndown 转换（精度非 100% 还原原始 markdown 格式，语义保留）。
- 快捷键 v1 只在源码编辑区（textarea）生效，即时模式暂无快捷键。
- 代码高亮主题固定 github.css；KaTeX 格式为 `$...$`/`$$...$$`（marked-katex-extension 默认）。
- 文件系统/链接系统/非线性视图未实现（大板块，需单独设计）。
