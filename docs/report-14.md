# Minex 阶段报告 14（2026-08-13）—— 阶段 13 检阅修复 + 工作流程改进

> 报告制度（固定四节）。前置：`docs/report-13.md` → `docs/review-phase13-report.md`。

---

## 一、工作流程改进（按审查建议，本轮起生效）

审查流程观察：**「表面正常、特定输入静默失效」类缺陷全部漏在纯逻辑未抽函数未测试**（W1 应用顺序、W2 CSS 生成）。改进规则：

1. **纯逻辑必须抽纯函数**：凡涉及「输入 → 输出」的可计算逻辑（CSS 生成、计划/排序、校验），从 UI 组件抽出为独立纯函数模块。
2. **纯函数必须有自动化测试**：每个新纯函数至少 3 个用例，覆盖正常 + 边界 + 冲突场景。UI 组件层不再承载可测逻辑。
3. **「测试全绿」是提交前置**：不跑绿不提交（上轮已确立，延续）。
4. 本轮立即实践：`buildCss`（W2）、`planApply`（W1）均抽出 + 测试。

---

## 二、检阅问题处理结果

| # | 问题 | 修复 | 代码定位 |
|---|---|---|---|
| W1 | applyAll 分组顺序产生悬空激活 | **抽纯函数 `planApply`**：传递依赖冲突检测（conflicts）+ 确定性顺序（禁用依赖者先/启用依赖先，深度排序）；冲突弹确认（confirm.onConfirm 继续执行） | `packages/ui-shell/src/plan-apply.ts` + `SettingsPage.tsx` applyAll/confirmApply |
| W2 | 含空格字体名无引号失效 | `quoteFont` 加引号（已带引号不重复）；buildCss 导出为纯函数 | `packages/appearance-driver/src/index.ts` |
| W3 | .pending-badge 重复定义 | 删第一处，保留带 unfinished 变体版 | `index.css` |
| W4 | 主区 min-width:0 可被压没 | 改 `min-width: 320px` | `index.css:88` |
| W5 | Resizer mouseup 丢失兜底 | window blur 视为释放 + 组件卸载强制清理（cleanupRef） | `App.tsx` Resizer |
| W6 | Select 无外部点击/Esc 关闭 | 与 DriverSelector 一致：ref + mousedown/Escape | `SettingsForm.tsx` Select |
| W7 | 自动保存无 debounce | setTimeout 300ms（卸载清理 timer）；UI 立即更新、存储延迟写 | `SettingsForm.tsx` setField |
| W8 | color 非法值静默 #000000 | 正则校验 `#RGB~#RRGGBBAA`，非法忽略 | `SettingsForm.tsx` Field color |

---

## 三、新增测试（流程改进的首次落地）

| 文件 | 用例 |
|---|---|
| `packages/appearance-driver/test/build-css.test.ts` | 4 用例：引号字体（W2 核心）/dark 选择器/空设置+customCss/不重复引号 |
| `packages/ui-shell/test/plan-apply.test.ts` | 6 用例：直接冲突/传递冲突/无冲突/禁用依赖者先/启用依赖先/禁用先于启用 |

---

## 四、审查标准

### 必须通过

1. 构建/类型检查/测试全绿（新增 10 用例，验证 agent 执行）。
2. W2 验收：设置 `Microsoft YaHei`/`JetBrains Mono` 等含空格字体 → 界面字体实际变化（此前静默失效）。
3. W1 验收：驱动管理「启用 B + 禁用 A」（B 依赖 A）→ 弹依赖冲突确认；确认后按计划执行。
4. W4 验收：左右栏拖到最大（480）→ 主区保持 ≥320px。
5. 无回归：报告 12/13 全部功能（布局/拖拽/窄条/主题/分组设置/未完成徽标）。

### 重点审查

- **P0 planApply**：transitiveDeps 的 seen 集合正确性（环安全）；depth 的环安全；冲突文案。
- **P0 confirm.onConfirm**：冲突确认后 executePlan 使用闭包 plan.steps——pending 在确认前若被修改（弹窗期间点其他行）是否 stale。
- **P1 buildCss**：quoteFont 对空串/已带单引号的边界；customCss 注入位置。
- **P1 debounce**：300ms 内切换设置页离开——timer 是否触发（组件卸载 cleanup 会清 timer → 最后 300ms 内的修改可能丢失）。**此边界请判：可接受（自动保存语义）还是需 flush-on-unmount。**

### 已知限制（勿误报）

- 冲突确认后按计划执行仍可能产生「启用连带激活被禁依赖」——文案已告知用户，属于用户确认后的预期行为。
- 拖拽宽度/待变更不持久（上轮已知）。
- debounce 导致 300ms 内的最后修改在组件卸载时可能丢失（见 P1 待判）。
