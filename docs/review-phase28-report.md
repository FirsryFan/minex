# Minex 阶段 28 审查报告（S4 会话总览 + 工作视图多开 + 浮窗贴靠）+ 三个实操问题

> 审查日期：2026-08-13　|　范围：会话总览面板、工作视图多开（InstanceState/WorkspaceInstance）、浮窗贴靠、Resizer 图标化
> 对照：`docs/report-28.md`。本报告集成学员实操发现的三个问题（吸附假效果 / 多实例干扰 / 任务视图目标）。

## 审查基线

- `npm run typecheck` ✅ **exit 0（7 包）**
- `npm run build` ✅ **exit 0**
- `npm test` ✅ **155/155** 全绿（18 文件）

---

## 一、BLOCKER —— 学员问题 1：吸附「特效真、效果假」，拖到右栏却回到左栏

### 根因
`App.tsx:234-237`（handleFloatDrop）+ `App.tsx:212-219`（dockPanel）

```tsx
function handleFloatDrop(id) {
  if (snapTarget) dockPanel(id);      // snapTarget 完全被忽略！
  setSnapTarget(null);
}
function dockPanel(id) {
  const p = panels.find((x) => x.id === id);
  if (p?.defaultDock === "floating") { ... }
  else { onUpdate({ floating: instance.floating.filter(f => f.id !== id) }); }  // 只回 defaultDock
}
```

`computeSnap` 算了 `left/right/main` 三种吸附目标（并显示了对应高亮框），但 `handleFloatDrop` 里 `snapTarget` **只用来判断「是否 dock」，没有用来决定「dock 到哪里」**。释放时 `dockPanel` 一律把面板从 floating 集合移除 → 面板回到**编译期写死的 `defaultDock`**。

文件树面板 `defaultDock = "left"`，所以拖到右栏（`snapTarget = "right"`，右栏高亮显示）→ 释放 → 回到 `defaultDock = "left"`。**特效是真的（高亮），效果是假的（回左栏）**——与学员描述完全一致。

### 学员指出的正确模型（应采纳）
面板分「侧栏类」与「主体类」，侧栏类的位置是一个**运行时状态** ∈ `{ left, right, floating }`，主体类 ∈ `{ main, floating }`。**吸附 = 改这个状态，渲染按状态分组**。

当前 `defaultDock`（静态）+ `floating: FloatingState[]`（布尔集合）的模型**无法表达「停靠到非默认位置」**。需重构 `InstanceState`：
```ts
// 由「defaultDock + floating 集合」改为「运行时 dock 状态」
dockState: Record<panelId, "left" | "right" | "main" | "floating">;
```
- 浮起 = `dockState[id] = "floating"`
- 吸附到右栏 = `dockState[id] = "right"`
- 关闭 = `dockState[id] = 默认停靠位`（defaultDock 降级为「关闭时的回退值」）
- 渲染按 `dockState` 分组（left/right/main/floating 四组）

---

## 二、MAJOR —— 学员问题 2：多工作视图不真正隔离（多窗口等效，但全局共享致干扰）

当前 `InstanceState` 只隔离了布局状态（activeDriverId/折叠/宽度/浮窗），**内核层仍是全局单例**，导致跨实例干扰：

### 干扰源 1：`filesystem:openFile` 全局广播，所有实例的 markdown 面板都响应
`markdown-driver/src/workspace-view.tsx` 订阅 `OPEN_FILE_TOPIC`（`kernel.events.on` 是全局总线）。实例 A 点开文件 → emit → **实例 B 的 markdown 面板（若挂载）也 openPath 同一个文件**。事件没有「目标实例」概念。

### 干扰源 2：`doc` 存储全局单例
`workspace-view.tsx` 用 `storage.namespace("minex.markdown").get("doc")`，所有实例共享同一个 `doc` key。「同一个驱动开不同文件」无法实现——实例 A 编辑会写同一个 `doc`，实例 B 读到。

### 干扰源 3：主设置界面是全局视图，非实例级
`App.tsx:119` `view === "settings"` 是 App 顶层 state，打开设置页会**替换整个工作区**（所有实例不可见），而非「某工作区打开设置」。学员期望「某个工作区可打开主设置界面」。

### 干扰源 4：驱动「重新加载」不检测运行时占用
`plan-apply.ts`（report-18）只检测**静态依赖冲突**（manifest dependencies），不检测「该驱动当前正被某个工作视图激活使用」。多实例后，禁用/重新加载一个正被某实例使用的驱动，会**静默影响那个实例**（其 main 面板消失/驱动 deactivate）。学员要求：重新加载时需同时判断「依赖驱动是否正在运行（activated 且被某实例使用）」，正在运行则不应允许临时更改。

### 方向建议（需架构决策，勿急于实现）
「多窗口等效」要求**内核实例化或至少事件/存储按实例命名空间隔离**。最低成本路径：给每个工作视图一个 `instanceId`，把「跨实例共享」与「实例私有」的边界显式化——
- **实例私有**：活动驱动、打开的文档/会话、浮窗、面板停靠态（当前 InstanceState 已隔离的部分 + doc 存储 + openFile 目标）
- **全局共享**：驱动生命周期、主题、驱动设置（同一软件后台唯一）
事件（`openFile` 等）需携带 `instanceId` 目标，或改为「实例内总线」。这是下一里程碑（多窗口等效）的前置设计，建议单独出方案而非本轮硬改。

---

## 三、学员问题 3（目标，集成到结尾）—— 工作视图切换应为 Windows「任务视图」风格

学员描述：**不应该是顶部选项卡**，应该是：
- 一个按钮，icon 为**两个部分重合的矩形**（一个虚化、一个不透明，即 Windows Task View 图标）
- **单击**弹出**横向长浮窗**，浮窗内是不同工作区的**预览**（缩略图/名称）
- 点击预览切换工作区

当前实现（`App.tsx:143-159`）是顶部 `view-strip` + `view-tab` 选项卡——需替换为上述「按钮 + 横向预览浮窗」。这是 UI 设计变更，非 bug，但应作为明确目标记录（见结尾「下一步目标」）。

---

## 四、MINOR / INFO（代码层面发现）

- **m1** `computeSnap` 用 `window.innerWidth` 判断右缘，而非「右栏左边缘」——吸附判断是「靠近窗口边缘」，不是「靠近右栏槽」，配合 BLOCKER 导致体验更糟。重构 dockState 时应改为按容器/栏的几何位置判断。
- **m2** `overview-view.tsx:49` 硬编码 `.mist/sessions/${type}/${id}.ses` 路径——与 `store.ts` 的 `sessionPath` 约定重复（跨包无法 import）。若路径约定变更，两处需同步。建议 session 能力暴露一个 `sessionPath(type, id)` 方法，或 `openSession` 直接调 store 返回路径。
- **m3** FloatingPanel `onDrop` 上报 `posRef.current`，而 `posRef` 经 `useEffect` 异步同步——mouseup 落在最后一次重渲染的 effect 之前时上报位置偏旧（边缘时序，影响吸附判断精度）。
- **INFO** overview-view 的 `store = registry.get<SessionStore>("session", "default")?.value` 正确用宿主视图 `.value`；总览走索引（`loadIndex` 轻量，不扫描正文）✓；Resizer 图标化（GripVertical + col-resize）+ blur 兜底 + 卸载清理正确 ✓；FloatingPanel 监听常驻 + ref 回调 + preventDefault（report-26 修复）保持正确 ✓。
- **INFO** `makeInstance` 的 `activeDriverId` 从 localStorage 读——多实例每个初始都读同一份 localStorage，实例间「活动驱动」初始值相同（之后才分化），属已知「不持久化」限制的延伸。

---

## 五、报告 28 验收逐条判定

| 标准 | 判定 |
|---|---|
| 三连全绿（7 包 / 155） | ✅ 真全绿 |
| 右栏会话总览（搜索/标签/列表/新建） | ✅ |
| 工作视图条：新建/切换/关闭，实例独立 | ◐ 布局状态独立 ✓；**内核事件/存储仍全局共享，非真正独立**（问题 2） |
| 浮窗拖到边缘高亮 → 释放回停靠 | ❌ **特效真、效果假**（问题 1，回 defaultDock 而非吸附目标） |
| Resizer 图标 + col-resize 光标 | ✅ |

---

## 六、结论与下一步目标

### 修复优先级
1. **BLOCKER**（问题 1）吸附状态化：`defaultDock + floating` → `dockState: Record<id, left|right|main|floating>`，吸附改状态、渲染按状态。这是本次「贴靠」功能从「特效」变「真效果」的唯一正确路径。
2. **MAJOR**（问题 2）多实例隔离：明确「实例私有 vs 全局共享」边界，`openFile` 等事件携带实例目标、`doc` 等存储按实例命名空间；「重新加载」增加「驱动正被某实例使用」的运行时占用判断。
3. **目标**（问题 3）任务视图：以 Windows Task View 为蓝本——右上「双矩形重合」图标按钮（一虚一实），单击弹横向预览浮窗（各工作区缩略图/名称），点击切换。替换现有顶部 `view-strip` 选项卡。

### 给学员/下一里程碑的架构提示
S4 暴露了一个根本矛盾：**「多工作视图」是布局层的概念，但内核（events/storage/registry/生命周期）仍是单例**。要做到「多窗口等效」，必须决定内核是否实例化：
- 若**内核保持单例**（推荐，驱动生命周期/设置全局一致），则工作视图只应是「同一内核上的多份视图状态」，**文档/会话/打开文件/停靠位是实例私有**，而**驱动启停、主题、设置是全局**。事件总线需要「广播 + 定向」两级：全局事件（dataChanged）广播，实例事件（openFile）定向到目标实例。
- 若**内核实例化**，则驱动要按实例各加载一份（存储、生命周期、能力全隔离），成本高、与「同一软件后台唯一」的目标冲突——不推荐。

建议下一轮先出一份「多工作视图隔离边界」的设计文档（实例私有/全局共享清单 + 事件定向方案），再动代码——避免在错误的隔离模型上继续叠加功能。
