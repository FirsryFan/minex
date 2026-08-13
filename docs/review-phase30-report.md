# Minex 阶段 30 审查报告（任务视图 UI）+ 多实例 markdown 内容串扰问题定位

> 审查日期：2026-08-13　|　范围：任务视图（Task View）UI、多实例 markdown 内容隔离问题
> 对照：`docs/report-30.md`。本报告重点回答学员提出的「工作区布局独立、但 markdown 编辑器内容一致」问题——明确错误位置，并给出**实现逻辑**（不写代码，代码实现交专业 agent）。

## 审查基线

- `npm run typecheck` ✅ **exit 0（7 包）**
- `npm run build` ✅ **exit 0**
- `npm test` ✅ **155/155** 全绿（18 文件）

---

## 一、学员问题的明确错误定位

> 现象：不同工作区的界面布置（栏宽/折叠/浮窗/活动驱动）是独立的，但 **markdown 编辑器打开的内容是一定的（跨工作区相同）**。

**结论：这不是任务视图（report-30）的问题，而是 report-28 问题 2「多实例隔离」尚未实施的表现。** `docs/multi-view-isolation.md` 已经把方案设计好，但**代码未落地**。当前有**三个全局单例**把「编辑器内容」钉死为一份：

### 错误 1：文档内容 `doc` 存在全局命名空间，无实例维度
`packages/markdown-driver/src/workspace-view.tsx:74`

```ts
useState(() => kernel.storage.namespace("minex.markdown").get<string>("doc") ?? DEFAULT_DOC)
```

`"doc"` 是**固定 key**。所有工作区的 markdown 面板初始化时读**同一个** `minex.markdown/doc`。实例 A 编辑写回这个 key，实例 B 的 markdown 面板挂载时也读这个 key → 内容一致。

### 错误 2：`filesystem:openFile` 全局广播，所有实例的 markdown 面板都响应
`workspace-view.tsx:110`（订阅）+ `workspace-view.tsx:151`（openPath）

`kernel.events.on(OPEN_FILE_TOPIC, ...)` 是**全局事件总线**。实例 A 点开文件 → emit → **实例 B 的 markdown 面板（若挂载）也执行 openPath 打开同一个文件**。事件没有「目标实例」概念。

### 错误 3：挂载补开 `lastOpenPath` 也全局
`workspace-view.tsx:119-123`

每个实例的 markdown 面板挂载时都读全局 `minex.filesystem/lastOpenPath` 补开「上次打开的文件」——导致任意实例挂载时都打开**同一个**文件。

### 共同根因：面板组件未接收 `instanceId`
`App.tsx:231-236`（panelLazy 类型）+ renderPanel 调用

面板组件（markdown workspace）的 props 仍是 `{ kernel }`，**没有 `instanceId`**。所以 markdown 面板无法「知道自己是哪个工作区」，自然无法把 doc/openFile/lastOpenPath 按实例区分。

---

## 二、可行的代码逻辑（按实施顺序，每步可独立验证）

> 以下为逻辑描述，非代码。总体对齐 `docs/multi-view-isolation.md`，但拆成「最小改动、每步可验证」的落地顺序。

### 第 1 步：给面板组件注入 `instanceId`（打通上下文）
- `WorkspaceInstance` 已经知道自己的 `instance.id`（`App.tsx` 的 `instance` prop）。
- 让 `renderPanel` 在渲染面板组件时，把 `instanceId` 作为第二个 prop 传进去（`kernel` 之外）。
- 面板组件的 props 类型扩展为 `instanceId?: number`（**可选**——没有实例概念的面板如总览、文件树可以忽略它；但 markdown 必须用）。

### 第 2 步：`doc` 按实例命名空间隔离（解决「内容一致」的核心）
- markdown workspace 组件收到 `instanceId` 后，读写文档缓冲的 storage key 由固定 `"doc"` 改为**按实例前缀**，例如 `doc@<instanceId>`（或 `instance-<id>:doc`）。
- 这样每个工作区的 markdown 面板读写各自独立的 key，互不覆盖。
- **迁移**：旧的单实例 `"doc"` 数据要映射到默认实例（第 1 个工作区）的 key，避免用户已有内容丢失。

### 第 3 步：`filesystem:openFile` 定向（解决「A 打开文件 B 也变」）
- 事件的 payload 增加可选字段 `targetInstanceId`。
- **生产端**（文件树点击 / 会话总览点击）emit 时带上「自己所属实例」的 id——文件树/总览面板也要拿到 `instanceId`（同第 1 步注入）。
- **消费端**（markdown workspace）收到事件后判断：若 payload 带 `targetInstanceId` 且不等于自己的 `instanceId`，则**忽略**；等于或未带（向后兼容单实例）才执行 openPath。

### 第 4 步：`lastOpenPath` 挂载补开按实例区分
- `lastOpenPath` 的存储 key 同样按实例前缀隔离（每个工作区记录「自己上次打开的文件」）。
- 或者：markdown 面板只在**本实例触发过 openFile** 时才补开，不读全局 lastOpenPath（把「补开」改为「实例内记忆」）。

### 第 5 步（连带，非本轮必需）：重新加载的运行时占用检查
- `plan-apply` 在禁用/重载某驱动前，检查是否有任何实例「正在 main 区使用该驱动」（`dockState[id] === "main" && driverId === 目标驱动`），正在使用则**拒绝临时变更**并提示先停用相关工作区。

---

## 三、report-30 本体（任务视图）简要审查

- **任务视图 UI 正确** ✓：右上双矩形重合图标（一虚一实）+ 单击弹横向预览浮窗 + 卡片点击切换 + Esc/遮罩关闭 + 卡片 × 关闭（保底 1 个）+ ＋ 新建，与 report-30 验收一致，替代了原顶部 view-strip 选项卡（学员问题 3 的目标达成）。
- **缩略图为布局示意色块**（非真实截图）——报告已知限制，接受。
- 多实例隔离仍待实施——报告已知限制已声明「按 multi-view-isolation.md 待实施」，本次审查把它**落成具体错误定位 + 分步逻辑**（见第二、四节）。

---

## 四、结论

1. **报告 30 的任务视图功能本身无缺陷**，三连全绿。
2. **学员报告的现象是「多实例隔离未实施」的直接后果**，错误精确位于三处：`doc` 固定 key、`openFile` 全局广播、`lastOpenPath` 全局补开，且共同根因是「面板组件未注入 `instanceId`」。
3. **实现逻辑已给出**（第四节五步，前四步解决 markdown 内容串扰，第五步解决 reload 占用）。每步独立可验证，建议按序实施，先做第 1 步（打通 instanceId）再依次隔离 doc / openFile / lastOpenPath。

**给专业 agent 的实施提示**：改动集中在三个文件——`ui-shell/src/App.tsx`（renderPanel 注入 instanceId）、`filesystem-driver` 的 sidebar/overview 面板（emit 带 targetInstanceId）、`markdown-driver/src/workspace-view.tsx`（接收 instanceId + doc 键前缀 + openFile 过滤 + lastOpenPath 键前缀）。无需改动内核（events/storage 接口不变，只是 key/payload 加实例维度）。
