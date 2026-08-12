# Minex 阶段 10 审查报告（暂存式启用/禁用 + 主题贡献 + 外观驱动）

> 审查日期：2026-08-12　|　范围：SettingsPage 暂存式重构、ThemeManager、App 主题提升、appearance-driver、sync-drivers 扫描
> 对照报告：`docs/report-10.md`。内核交互断言经 node 脚本实测。

## 审查基线

- `npm run typecheck` ✅ `npm run build` ✅（vite 171KB）
- `npm test` ❌ **2 failed / 75 passed**（见 BLOCKER T0）

## BLOCKER（必须修）

### T0 — storage-local 新增测试失败，基线不绿
`packages/ui-shell/test/storage-local.test.ts:15`

2 个 D2 测试失败（`list()` 期望 `["b.c"]` 实际 `[]`）。**根因是测试基建 bug，不是产品缺陷**：

```js
// fakeLocalStorage 里 length 是静态 0，非 getter
length: 0,
```

`createLocalStorageStorage` 的 `list()` 用 `for (let i = 0; i < ls().length; i++)` 遍历——fake 的 `length` 恒为 0 → 循环不执行 → 永远返回空数组。修复 1 行：`get length() { return map.size; }`。

**产品实现（storage-local.ts）本轮 D2/D4/D5 修复本身正确**（已核实）：
- keyOf `name:encodeURIComponent(key)`，分隔符 `:` 在 name 中不可能出现（assertName 限制 `^[A-Za-z0-9_.-]+$`）→ namespace 与 key 含点/含冒号均无串扰；
- D4 `set(undefined)` → `removeItem`（不存 "undefined" 字符串）；
- D5 `get` 对损坏 JSON 容错返回 undefined。

另外报告声称「本轮无新增自动化测试」与实际不符（storage-local 从 3 增至 7，+4）。

---

## MAJOR（建议修）

### S1 — `applyAll` 依赖顺序缺陷：禁用依赖 + 变更依赖者组合出问题
`packages/ui-shell/src/components/SettingsPage.tsx:167-173` + `applyDriverState:282-295`

**实测（node 复现）**，pending = `{ A: false, B: true }`（B 依赖 A，B 已 deactivated）：

| 顺序 | 结果 |
|---|---|
| 先 A 后 B | B `reload` → 连带激活依赖 A → A deactivated 态抛错 → **B 变 `failed`，错误被 `applyDriverState` catch 吞掉，pending 无条件清空，用户无感知** |
| 先 B 后 A | B `reload` 成功（连带激活 A）→ 再 `deactivate(A)` → **B 保持 `activated` 但依赖 A 已停用 = 悬空激活** |

**根因**：`applyAll` 按 `Object.entries(pending)` 插入序逐项应用，无依赖拓扑顺序，且失败静默。

**建议**：apply 前按依赖拓扑排序（先禁用依赖者、后禁用依赖；先启用依赖、后启用依赖者）；或 apply 后校验一致性并保留失败项（pending 不清空 + 汇报），而非吞错清空。

---

## MINOR（可留）

- **S2** `setAll(false)` 绕过依赖警告：直接 `setPending` 全 false，不调 `mark`（mark 里有 `dependents` 确认），「全部禁用」可无声禁掉被依赖驱动。
- **S3** `applyDriverState` catch 吞错误 + `applyAll` 无条件 `setPending({})`：失败项（如 reloadable:false 驱动启用）不可见、不保留。
- **S4** 依赖警告只查直接依赖（`dependencies?.includes`），传递依赖（Z→Y→X）禁用 X 不警告。
- **S5** pending 不持久：切出设置页（ManageView 卸载）待变更丢失，无提示。
- **T1** `ThemeManager` 只在 workspace 视图渲染（`App.tsx:58-60` settings 提前 return）→ 设置页内驱动主题贡献（如外观驱动改主题色）不应用，style 残留上次内容，工作区与设置页外观不一致。
- **T2** `ThemeManager` 依赖 `[mode, themes]`，`themes` 是 query 每次返回的新数组 → effect 每次渲染执行（重复写 `style.textContent`），性能小瑕疵。
- **I1** `DriverIcon` 相对路径图标（`./assets/icon.svg`）不被 `isImage` 识别（只认 `data:`/`http`/`/` 开头）→ 未经 Vite 覆盖时（如未来 Electron 直接 loadFromDir）显示路径文本而非图片。

---

## INFO（观察）

- **外观驱动无环确认**：`apply()` 只由 `activate` 与 `minex:dataChanged` 触发，驱动不订阅 `theme` onChange → 无无限循环。
- **buildCss 覆盖关系正确**：light→`:root`、dark→`[data-theme="dark"]`，注入 style 在 theme.css 之后 → 同特异性后胜覆盖系统默认。
- **sync-drivers 扫描正确**：跳过无 manifest.json 的 kernel/cli/ui-shell；`drivers:sync` 前置 build appearance+demo ✓。
- **SettingsForm props 化**：上一轮 U3（`plugin!` 崩溃）已修复（driverId 由 props 传入）；number 空输入保留原值 ✓。
- 主题状态提升到 App（`dark` state + `dataset.theme` + localStorage）✓；ThemeToggle 改纯 props 组件 ✓。
- 驱动图标图片化：`drivers.ts` 用 Vite 解析的资产 URL 覆盖 `manifest.icon`，浏览器 `<img>` 渲染 ✓。

---

## 五、简报重点问题判定

| 简报问题 | 判定 |
|---|---|
| P0 暂存式状态机 | pending set/撤销/清空 ✓；**apply 顺序有缺陷**（S1）；reloadable:false 容错 ✓（catch） |
| P0 ThemeManager | CSS 注入/移除 ✓（无 theme 时 null 到空 style）；mode 切换重应用 ✓；订阅清理 ✓；**settings 视图不渲染**（T1） |
| P1 外观驱动 | buildCss 覆盖关系 ✓；data:changed 重注册**无环** ✓ |
| P1 sync-drivers | 扫描 packages/* 正确跳过非驱动包 ✓ |

---

## 六、测试缺口

- SettingsPage 无自动化测试（S1/S2/S3/S5 全部漏检——暂存式状态机是本轮核心，却零测试）。
- ThemeManager 无测试（T1/T2）。
- storage-local 产品修复正确但**测试基建自身 bug** 拖垮基线（T0）。

---

## 七、结论与修复优先级

架构上「暂存式 + 主题贡献 + 外观驱动」三个设计都正确且相互独立，外观驱动的无环证明、buildCss 覆盖关系、sync 扫描都干净。但**基线不绿 + apply 顺序缺陷**两件事必须处理：

1. **T0**（BLOCKER）fake `length` 改 getter，1 行恢复基线。
2. **S1**（MAJOR）applyAll 依赖拓扑排序 + 失败保留汇报。
3. 补 SettingsPage 单测（S1/S2/S3 漏检根源）。
4. S2/S4 依赖警告补强、T1 settings 视图主题应用、I1 相对路径图标，依次顺手修。

**注**：本轮报告文档称「无新增自动化测试」有误（实际 +4）；且新增测试未跑绿就作为完成态提交，与「验证 agent 复核」的流程宣称不符——建议把「测试全绿」作为提交前置条件。
