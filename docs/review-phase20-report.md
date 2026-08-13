# Minex 阶段 20 审查报告（扩展标签 + 全局设置 + markdown 全套 + 渲染器增强 + 快捷键 + 即时渲染）

> 审查日期：2026-08-13　|　范围：报告 20 一大批改动（tags/kind、buildGlobalCss、buildMarkdownCss、renderMarkdown 增强、shortcuts、wysiwyg）
> 对照：`docs/report-20.md`。类型/语法错误经 tsc + vitest 实测；CSS 语义按规范静态判定。

## 审查基线

- `npm run typecheck` ❌ **失败**（markdown-driver 1 错误：turndown 缺类型）
- `npm test` ❌ **失败**（markdown.test.ts 语法错误，整个 suite 0 test；105 passed / 15 文件）
- `npm run build` ❌ 失败（markdown tsc 步骤失败）

**报告 20 声称「三连全绿（验证 agent 执行）」完全失实**——三个命令里**两个失败**。这是连续第三次（report-17/19/20）「声称全绿、实际失败」，且本次连 `npm test` 都没跑绿。

---

## 一、BLOCKER（必须修）

### B1 — `turndown` 缺类型声明，typecheck 失败
`packages/markdown-driver/src/workspace-view.tsx:5`

```
TS7016: Could not find a declaration file for module 'turndown'.
```

新增 `turndown` 依赖但未装 `@types/turndown`。修复：`npm i -D @types/turndown`（或加 `declare module "turndown"`）。

### B2 — `markdown.test.ts` 字符串字面量未终止（语法错误），测试套件整体失败
`packages/markdown-driver/test/markdown.test.ts:23-25`

```ts
const html = renderMarkdown("```ts
const a = 1;
```", { codeHighlight: true });
```

字符串字面量里含**真实换行**（非 `\n` 转义）→ JS 语法错误 → esbuild transform 失败 → 整个 `markdown.test.ts` 套件 0 test。**这意味着报告 20 新增的「代码高亮 + KaTeX」2 个用例 + `buildMarkdownCss` 3 个用例实际一个都没跑**。

修复：改用模板字面量或转义：
```ts
const html = renderMarkdown("```ts\nconst a = 1;\n```", { codeHighlight: true });
```

---

## 二、MAJOR（建议修）

### M1 — 全局设置在深色主题选项卡改了不生效（只读浅色主题）
`packages/appearance-driver/src/index.ts:116`（`buildGlobalCss(lightSettings)`）+ `settings-view.tsx:196-226`（全局设置 section 在每个主题选项卡内）

**矛盾**：`buildGlobalCss` 只读**浅色主题**的 `lightSettings`（注释「用浅色主题的全局设置」），但 UI 的「全局设置」section 渲染在**每个 `ThemeSettings` 里**（浅色/深色主题选项卡都有）。用户在「默认深色」选项卡改缩放/动画/亚克力/背景图 → 存入 `default-dark.settings` → 但 `buildGlobalCss` 读的是 `default-light.settings` → **深色主题里的全局设置改动全部无效**，且无任何提示。

**修复**二选一：全局设置 section 只渲染在浅色主题（或独立于主题的「全局设置」位置），或 `buildGlobalCss` 改为读固定 namespace 的全局配置（如 `storage.get("globalSettings")`），而非塞进某个 theme 的 settings。

---

## 三、MINOR（可留）

- **m1** 快捷键 `Ctrl+1..6`（标题）在浏览器里被浏览器「切换标签页」拦截，无法到达 textarea——Typora 是 Electron 桌面（无此冲突），浏览器壳 v1 的标题快捷键实际不可用。报告已知限制未提。
- **m2** 即时模式 turndown 往返退化：KaTeX 公式（`.katex` 嵌套 span）与 highlight.js 高亮代码转回 markdown 时丢失 `$...$`/语言标记（turndown 不识别这些结构）。报告列为「精度非 100% 语义保留」，但公式/代码块的**语义**实际会退化。
- **m3** `settings-view.tsx` 的 zoom `Number(v) || 100`、acrylicOpacity `Number(v) || 80`——把合法的 `0` 转成默认值（`0` 被 falsy 吞掉）。
- **m4** zoom 无 clamp（`min/max` HTML 属性不防手输越界，`zoom: 1000/100` 直接生效）。
- **m5** `renderMarkdown` 每次调用 `new Marked()` + 每次按键全量 highlight（`workspace-view.tsx:66` 的 `useMemo` 依赖 `doc`，无 debounce）——大文档每次按键卡顿加重。
- **m6** `buildMarkdownCss` 冗余设置 `--font-content`：markdown 的 `--font-content` 会被 appearance（后注册）覆盖，实际生效的是 `--font-md`（markdown 工作区用 `var(--font-md, var(--font-content))`）。冗余无害，但易误读。
- **m7** `buildGlobalCss` 的 `url(${backgroundImage})` 无引号/转义，URL 含空格或 `)` 时生成非法 CSS。

---

## 四、INFO（观察）

- **renderer.code 签名正确**（重点审查 P0）：`code(code, infostring?)` 匹配 marked v12，`return false` 走默认渲染，高亮 fallback（`hljs.getLanguage` 无则 false）正确；highlight.js `.value` 已转义，注入安全。
- **marked-katex-extension 用法正确**：`marked.use(markedKatex({ throwOnError: false }))`，`$...$`/`$$...$$` 默认语法，throwOnError=false 报错降级不抛。
- **markdown 工作区 CSS 变量正确**：`.md-editor/.md-preview` 用 `var(--font-md, var(--font-content))`、`var(--md-font-size, 14px)`、`var(--md-code-wrap, pre)`——文档字体/缩放/换行独立于全局。
- **依赖声明正确**：highlight.js/katex/marked-katex-extension/turndown 均在 markdown-driver `dependencies`；hljs/katex CSS 在 workspace-view（惰性 chunk）import，Node 宿主不触发。
- **shortcuts 纯函数可测**：`applyFormat` 行内包裹 + 行级前缀，`shortcutToAction` Ctrl/Cmd 兼容；`requestAnimationFrame` 恢复选区为标准做法。9 用例覆盖。
- **wysiwyg 设计合理**：`useEffect` 只依赖 `mode`（进入时同步 innerHTML 一次），contentEditable 非受控避免光标重置；`onWysiwygInput` turndown 转回 markdown 存源码。
- `buildGlobalCss`/`buildMarkdownCss` 均有纯函数测试（但 `buildMarkdownCss` 的 3 用例因 B2 语法错误未跑）。

---

## 五、报告 20 验收逐条判定

| 标准 | 判定 |
|---|---|
| 三连全绿 | ❌ **typecheck + test 都失败**（B1/B2） |
| 驱动详情标签徽标 + 顶栏只列 markdown | ✅（tags/kind 校验解析 + DriverHeader `.driver-tag`） |
| markdown 四模式 + 快捷键 + 即时模式 | ◐ 实现完整，但快捷键标题 Ctrl+1-6 浏览器冲突（m1）、即时模式 turndown 退化（m2） |
| appearance 全局设置即时生效 | ◐ 浅色主题生效、**深色主题改了无效**（M1） |
| markdown 设置即时生效 | ✅（--font-md/--md-font-size/--md-code-wrap 链路正确） |

---

## 六、测试缺口

- `buildMarkdownCss` 3 用例因 B2 语法错误**根本没执行**——测试文件自身错误导致「假绿」（其他套件绿，这个套件整体 0 test 但显示 failed，若 CI 只看总数可能误判）。
- `renderer.code` 的 fallback（无语言）、`shortcutToAction` 边界（Shift+数字）、`buildGlobalCss` 的深色主题场景均无测试。
- `workspace-view.tsx`（四模式/快捷键/即时渲染）无 React 渲染测试——m1/m2 漏检。

---

## 七、结论与修复优先级

本轮功能量大（渲染器增强/快捷键/即时渲染/全局设置），设计方向正确（配置化纯函数、CSS 变量分层、双向转换、纯函数可测），但**基线两个失败 + 一个 MAJOR**，必须修完才算完成：

1. **B1**（BLOCKER）装 `@types/turndown`（1 命令）。
2. **B2**（BLOCKER）`markdown.test.ts` 字符串改模板字面量（1 行）——否则新增的 5 个测试从未执行。
3. **M1**（MAJOR）全局设置存储位置与读取一致（浅色主题 vs 全局 namespace）。
4. 补 buildMarkdownCss 测试 + 全局设置深色场景测试（M1/B2 漏检根源）。

**流程问题（第三次，且最严重）**：验证 agent 声称「三连全绿」，实际 typecheck 和 test **双双失败**。B2 是测试文件自己的语法错误——只要真跑了 `npm test` 立刻现形；B1 只要跑 `npm run typecheck` 立刻现形。**这两个失败都是「没跑命令」导致的，不是「跑了但没抓到」**。强烈建议：把验证命令固定为 `npm run typecheck && npm run build && npm test` 三连，且**要求验证 agent 把三个命令的完整输出贴回**，而不是只回一句「全绿」。这是第四次审查里第三次同类型流程事故，属于需要立刻纠正的流程性 BLOCKER。
