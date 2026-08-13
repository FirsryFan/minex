# Minex 阶段报告 22（2026-08-13）—— 执行阶段 21 审查修复 + UI 反馈（折叠按钮/层次感）

> 报告制度（固定四节）。本轮内容：修复 `review-phase21-report.md` 的 B1（showDirectoryPicker 类型缺失）与 M1（设置页往返重弹「选择文件夹」）；修复用户反馈的 UI 问题（左右侧栏折叠入口缺失、三栏层次感不足）；**本轮亲自跑三连验证并贴退出码证据**。
> 前置：`docs/report-21.md` → `docs/review-phase21-report.md`。

---

## 一、上次问题回归

### B1（BLOCKER）—— showDirectoryPicker 类型缺失，typecheck 失败 → 已修复 ✅

- **根因**：TS 5.6 的 lib.dom 已有 `FileSystemHandle / FileSystemDirectoryHandle / FileSystemFileHandle`，但**缺 `showDirectoryPicker`（Picker 方法）与 `FileSystemDirectoryHandle.entries()`**。
- **修复**：新建 `packages/filesystem-driver/src/fs-access-types.ts`（`declare global` 补充这两个缺项），被 `fs.ts` side-effect import。这样 **filesystem 包自身与 ui-shell（经 `drivers.ts` import 驱动源码）两个编译上下文都能加载声明**——单一来源，避免在 ui-shell 重复声明。
- 曾尝试 `vite-env.d.ts` 方案：filesystem 包 typecheck 通过，但 ui-shell 的 tsc 也编译 fs.ts 且不含该文件 → 仍报错，故弃用。

### M1（MAJOR）—— SidebarView 挂载补开误用 `openRoot()` → 已修复 ✅

- **根因**：挂载 effect 调 `openRoot()`（内含 `showDirectoryPicker`），从设置页往返时 SidebarView 重挂载 → 重新弹「选择文件夹」对话框。
- **修复**：`sidebar-view.tsx` 挂载 effect 改调 `refreshTree()`（仅 `readDir("")` 恢复树，保留不弹窗）；`openRoot()` 只由「打开文件夹」按钮触发。

### 审查 m1-m4 / INFO 结论

- **m1**（markdown `fs` 用 `useMemo([kernel])` 缓存旧引用）：filesystem reload 后 markdown 侧旧引用——边缘场景，本轮不改（记入已知限制）。
- **m2**（topic 字面量重复）：已知限制（未抽共享协议包）。
- **m3**（无脏检查）：已知限制。
- **m4**（`readFile/writeFile` 重复 `resolveSafePath`）：无害冗余，本轮不改。
- INFO 全部确认正确（事件协议/竞态/补开闭环/`.value`/hooks/依赖顺序/路径安全）。

---

## 二、本轮目标与内容

| # | 内容 | 定位 |
|---|---|---|
| 1 | B1 类型修复 | `fs-access-types.ts` + `fs.ts` side-effect import |
| 2 | M1 挂载逻辑修复 | `sidebar-view.tsx` 挂载 effect 改用 `refreshTree` |
| 3 | 左右侧栏折叠入口缺失 | 折叠按钮从 `MainArea`（仅无驱动工作区时渲染）上移到**常驻顶栏** `TopBar` |
| 4 | 三栏层次感不足 | 新增 `--color-panel` 层次令牌（浅 `#e9eef6` / 深 `#16233a`），`.sidebar/.rightbar` 用它，与主区 `--color-bg` 形成相对深色对比 |
| 5 | 验证证据 | 亲自跑 `typecheck && build && test`，贴退出码与用例数 |

---

## 三、具体实现

### 文件清单与联系

| 文件 | 职责 |
|---|---|
| `packages/filesystem-driver/src/fs-access-types.ts`（新） | `declare global`：`showDirectoryPicker` + `FileSystemDirectoryHandle.entries()`（lib.dom 缺项） |
| `packages/filesystem-driver/src/fs.ts` | 顶部 side-effect `import "./fs-access-types.js"`（声明随 fs.ts 被两个编译上下文加载） |
| `packages/filesystem-driver/src/sidebar-view.tsx` | 挂载 effect：`openRoot()` → `refreshTree()`（恢复树不弹窗） |
| `packages/ui-shell/src/components/TopBar.tsx` | 新增 `collapsed/onToggleLeft/onToggleRight` props + 左右折叠 `icon-btn`（常驻） |
| `packages/ui-shell/src/App.tsx` | TopBar 传入 collapsed 与两个 toggle 回调 |
| `packages/ui-shell/src/theme.css` | 浅/深模式各加 `--color-panel` |
| `packages/ui-shell/src/index.css` | `.sidebar/.rightbar` 背景 `--color-bg` → `--color-panel` |

### 关键设计

1. **类型补充单一来源**：不装 `@types/wicg-file-system-access`，用 `declare global` 模块被 `fs.ts` 引用来覆盖 filesystem 与 ui-shell 两个编译上下文；UI 组件不承载声明。
2. **折叠入口常驻**：`MainArea` 的折叠按钮只在无驱动工作区时渲染，导致 markdown/filesystem 工作区下入口消失；将入口上移顶栏（所有工作区视图可见），`MainArea` 内保留原按钮，两处操作同一 `collapsed` state。
3. **层次令牌化**：遵循主题注释约定「结构层只用令牌」，新增 `--color-panel`，深浅模式各一值，三栏与主区背景产生相对对比。

### 验证证据（三连，exit 码为「通过」证据）

```
npm run typecheck  → exit 0（kernel/filesystem/appearance/markdown/cli/ui-shell 6 包 tsc --noEmit 全绿）
npm run build      → exit 0（vite build ✓ built in 12.54s）
npm test           → exit 0（Test Files 17 passed；Tests 127 passed）
```

---

## 四、审查标准

### 必须通过（已亲自验证，外部验证 agent 复核）

1. 三连全绿，且 **typecheck 必须贴退出码 0**（本轮已贴，杜绝「声称全绿实际失败」）。
2. 打开文件夹 → 切设置页 → 返回工作区：**不再弹出「选择文件夹」对话框**，文件树恢复展开。
3. 任意工作区（markdown / filesystem）顶栏可见左右折叠按钮；点击折叠/展开对应侧栏。
4. 浅色模式：侧栏底色（`#e9eef6`）明显深于主区（`#f3f6fb`）；深色模式：侧栏（`#16233a`）略亮于主区（`#0f172a`），三栏层次清晰。

### 重点审查

- **P0 类型**：`fs-access-types.ts` 的 `declare global` 是否在 filesystem 与 ui-shell 双上下文生效（typecheck 已证）。
- **P0 M1**：设置页往返不弹窗（`refreshTree` 不含 `showDirectoryPicker`）。
- **P1 折叠**：TopBar 按钮与 MainArea 按钮状态同步（同一 state）；折叠窄条 CSS（`.collapsed`）不受背景令牌影响。
- **P1 层次**：`--color-panel` 在浅/深两模式的值是否合适；文件树/面板文字对比度。

### 已知限制（勿误报）

- **m1**（markdown `fs` 缓存旧引用）：filesystem reload 后需重载 markdown 才取到新能力——边缘场景，未处理。
- **m2**（事件 topic 字面量重复三处）：未抽共享协议包，改动 topic 需同步 App / filesystem / markdown。
- **m3**（无脏检查）：打开文件后未保存直接点另一文件丢弃改动。
- **m4**（`resolveSafePath` 重复校验）：无害冗余。
- `fs-access-types.ts` 与 lib.dom 类型为「接口合并」关系，若升级 TS 后 lib.dom 补全这些 API，需删除补充声明（届时 typecheck 会提示重复/冗余）。
- 折叠入口在顶栏为图标按钮（`«`/`»`），无文字提示依赖 title 属性。

---

**提交状态**：本轮改动未 git 提交（待确认后提交）。
