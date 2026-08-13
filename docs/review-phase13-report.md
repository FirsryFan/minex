# Minex 阶段 13 审查报告（报告 12+13 统一审查）

> 审查日期：2026-08-13　|　范围：报告 12（12 条 UI 细节反馈）+ 报告 13（布局引擎 flex/拖拽/窄条、未完成标记、demo panel 取消选中）
> 对照：`docs/report-12.md` + `docs/report-13.md`。内核交互断言经 node 脚本实测；CSS 语法问题按规范静态判定。

## 审查基线

- `npm run typecheck` ✅ `npm run build` ✅（vite 176KB / 57KB gzip）
- `npm test` ✅ **77/77** 全绿（上轮 T0 fake `length` 已修复）

---

## 一、上一轮问题回归（report-10 审查）

| 上轮项 | 判定 |
|---|---|
| T0 fake `length` 测试基建 | ✅ 已修复（基线 77 全绿） |
| S1 applyAll 依赖顺序 | ◐ **部分修复**（失败保留 ✓、汇报 ✓，但分组顺序产生悬空——见本轮 W1） |
| S2 setAll(false) 绕过依赖警告 | ✅ 已修复（setAll 前收集被依赖驱动弹确认，`SettingsPage.tsx:195-201`） |
| T1 设置页不渲染 ThemeManager | ✅ 已修复（settings 视图也挂载 `<ThemeManager>`，`App.tsx:71-77`） |
| D4/D5 undefined/损坏值 | ✅ 上上轮已修复 |

---

## 二、MAJOR（建议修）

### W1 — `applyAll` 分组顺序产生「悬空激活」：启用组先于禁用组的固定顺序不解决依赖冲突
`packages/ui-shell/src/components/SettingsPage.tsx:205-223`

**实测**：pending = `{ B: true, A: false }`（B 依赖 A，B 已停用，用户想「重新启用 B + 禁用 A」）→ 按「先启用组后禁用组」应用：
- B reload → lifecycle 连带激活 A（B 的依赖链）→ B `activated`；
- A deactivate → 成功；
- **终态：B `activated` + A `deactivated` = 悬空激活，依赖已断开**。

**问题**：注释声称「先启用[依赖先于依赖者]，后禁用[依赖者先于依赖]」——但代码只是把 pending 分成两组按插入序执行，**没有任何依赖拓扑或冲突检测**。启用组先跑时，禁用组里的依赖会被启用项连带激活，随后再被禁用，产生悬空。反过来（禁用先跑）则启用项会因依赖被禁而失败。

**建议**：apply 前做冲突检测——若某启用项的依赖也在禁用组中，弹确认或按「禁用依赖者 → 禁用依赖 → 启用依赖 → 启用依赖者」的真实拓扑执行；apply 后校验每个 activated 驱动的依赖状态一致性。

### W2 — 字体设置对含空格字体名全部失效（buildCss 拼接无引号）
`packages/appearance-driver/src/index.ts:26-30`

```js
const uiFont = [s.uiEnFont, s.uiZhFont].filter(Boolean).join(", ");
if (uiFont) lines.push(`  --font-ui: ${uiFont}, system-ui, sans-serif;`);
```

**判定**：CSS 规范要求 font-family 中**含空格的字体名必须加引号**。实测拼接产物 `--font-ui: Arial, Microsoft YaHei, system-ui, sans-serif;` → `Microsoft YaHei` 被解析为 `Microsoft` + `YaHei` 两个不存在的字体系列 → 静默回退 system-ui。**枚举列表里绝大部分选项含空格**（Microsoft YaHei、PingFang SC、Times New Roman、Trebuchet MS、Noto Sans CJK SC、JetBrains Mono、Fira Code、Cascadia Code…）→ 报告 12 #10「字体中英文独立 + 代码字体单独」的核心功能对几乎所有选项失效，且**无任何报错**（浏览器静默回退）。

**建议**：`cssLine` 对字体值统一加引号：`--font-ui: ${[uiEn, uiZh].map(f => `"${f}"`).join(", ")}, system-ui, sans-serif;`。

---

## 三、MINOR（可留）

- **W3** `.pending-badge` 在 index.css 定义了两次（`479-486` 与 `585-592`），后者同特异性覆盖前者，冗余。
- **W4** 主区 `min-width: 0` 与审查标准「主体有最小宽度」矛盾（`index.css:88`）：注释称「实际最小宽度由主体内容决定」，但 `min-width:0` 恰恰允许收缩到内容以下（内容不撑开）。极端拖拽（两侧都到 480）时主区可被压到近零宽度，`overflow:hidden` 裁掉内容。
- **W5** Resizer 无 `mouseup` 丢失兜底（窗口外/iframe 释放鼠标时 `mouseup` 收不到 → 拖拽状态残留），也无组件卸载时监听器清理。
- **W6** SettingsForm `Select` 无「点外部关闭 / Esc 关闭」（DriverSelector 有，行为不一致）。
- **W7** 自动保存无 debounce：textarea 每次按键触发「storage 写 + data:changed → 驱动重注册 → ThemeManager 重应用」全链路，customCss 大文本时频繁全量序列化 + 重写 style 标签。
- **W8** color 输入在 value 非法时浏览器静默回退 #000000，无校验提示（manifest 有 default 兜底，影响小）。

---

## 四、INFO（观察）

- **报告 13 四条全部落地**：#2 折叠窄条（`.collapsed` 32px + `overflow-x:hidden`）✓；#3 拖拽（Resizer clamp 160-480，右栏 `w.right - dx` 方向正确）✓；#7 未完成徽标（`pending-badge unfinished` + `--color-unfinished` 令牌 + 外观驱动可覆盖）✓；#12 demo panel 再点取消（`id === selectedPanelId ? null : id`）✓。
- **报告 12 验收项核对**：#1 详情头部（72px 图标 + source/描述/状态）✓；#4 hasWorkspace 过滤 ✓（demo/appearance 未设 → 选择器空，显示「（无匹配驱动）」占位）；#5 CSS 编辑 ✓（textarea + customCss 追加）；#6 左栏导航清除详情 ✓；#8 分组 ✓（groups 渲染多卡片，兼容无分组 properties）；#9 按钮语义 ✓（`.btn` 中性底随深浅、hover 主题色、active inset 框线）；#10 字体下拉 ✓（enum 带搜索 Select；**但含空格字体失效见 W2**）；#11 去框线 ✓。
- **自动保存一致性** ✓：setField 基于 storage 最新 config 合并写入 + emit；切走重挂载重读 storage。
- **主题链路无环** ✓：apply 只由 activate/data:changed 触发，驱动不订阅 theme onChange。
- `color-mix()` 用于 unfinished 徽标背景（`index.css:594`）：需 Chrome 111+ / Safari 16.2+ / Firefox 113+，现代浏览器 OK，旧浏览器回退纯色（fallback 存在）。
- customCss 直接注入 `<style>`：含 `</style>` 可逃逸出标签注入 HTML。v1 全信任模型（驱动可执行任意代码）下不构成新增风险，未来引入第三方驱动前需清洗。
- 折叠时 Resizer 卸载、展开时重挂，宽度 state 保留 ✓；窄条用 `!important` 与 inline `width: undefined` 不冲突 ✓。

---

## 五、审查标准逐条判定

| 标准 | 判定 |
|---|---|
| 构建/typecheck/test 全绿 | ✅ 77/77 |
| 布局：拖拽 clamp / 窄条 / 无横向滚动 / 主体最小宽 | 前三 ✓；**主体最小宽未实现**（W4） |
| 折叠按钮纯图标、标题居中 | ✓（space-between + 左右等宽按钮视觉居中） |
| 未完成黄色徽标可被外观驱动覆盖 | ✓（token + unfinishedColor 字段 + color-mix） |
| demo panel 点选/取消 | ✓ |

## 六、测试缺口

- SettingsPage / applyAll 无测试（W1 悬空场景漏检；上轮 S1 部分修复无回归测试）。
- buildCss 无测试（W2 字体引号问题漏检——一条「生成合法 CSS」的单元测试即可抓出）。
- Resizer、布局 CSS 纯 UI 无自动化（已知限制，可接受）。

---

## 七、结论与修复优先级

报告 12+13 的 12 条反馈中 10 条完全落地、2 条按学员决定延后，布局引擎重构干净（flex 结构、窄条、拖拽方向都正确），上一轮 T0/S2/T1 全部修复，基线健康。两个 MAJOR 都是「表面功能正常、特定输入下静默失效」类：

1. **W2** 字体引号（约 2 行，一行 CSS 即可修复，影响 #10 核心功能大部分选项）——最优先。
2. **W1** applyAll 依赖冲突检测（禁用组与启用组的依赖交叉需拓扑或确认）——次优先。
3. 补 buildCss 单测（W2 漏检根源）+ applyAll 冲突场景测试（W1 漏检根源）。
4. W3/W4/W5/W6/W7 顺手修。

**流程观察**：本轮基线全绿、上轮问题有回归验证——相比 report-10「未跑绿即提交」是明显改进。剩余风险集中在 UI 纯手测路径（暂存式应用、CSS 生成），建议把「buildCss 生成合法 CSS」「applyAll 依赖冲突」加入自动化测试，这两处正是本轮 MAJOR 的漏检点。
