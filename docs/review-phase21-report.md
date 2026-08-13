# Minex 阶段 21 审查报告（markdown 适配 filesystem + 交接前清理）

> 审查日期：2026-08-13　|　范围：filesystem-driver 新包、markdown 打开/保存路径、事件协议、App 侧边栏/openFile 订阅
> 对照：`docs/report-21.md`。类型错误经 tsc 实测；React 语义按官方行为判定。

## 审查基线

- `npm test` ✅ **127/127** 全绿（17 文件）
- `npm run typecheck` ❌ **失败**（filesystem-driver 1 错误）
- `npm run build` ❌ 失败（filesystem tsc 步骤失败）

**报告 21 声称「三连全绿」且本次自己在报告里写了「务必贴回三个命令的完整输出（历史上多次只跑 test 漏掉类型错误）」——结果 typecheck 依然失败**。这是**第四次**（report-17/19/20/21）「声称全绿、实际 typecheck 失败」，且是在报告自己预警之后。

---

## 一、BLOCKER（必须修）

### B1 — `showDirectoryPicker` 缺类型声明，typecheck 失败
`packages/filesystem-driver/src/fs.ts:46`

```
TS2304: Cannot find name 'showDirectoryPicker'.
```

`showDirectoryPicker` 是 File System Access API，TS 标准 DOM lib 不含它（`FileSystemDirectoryHandle` 有，Picker 方法没有）。

**修复**二选一：
- `npm i -D @types/wicg-file-system-access`（提供 showDirectoryPicker 等 Picker 类型）；
- 或 `vite-env.d.ts` 里手动 `declare global { function showDirectoryPicker(): Promise<FileSystemDirectoryHandle>; }`。

---

## 二、MAJOR（建议修）

### M1 — SidebarView 挂载补开逻辑误用 `openRoot()`：从设置页返回会重新弹「选择文件夹」对话框
`packages/filesystem-driver/src/sidebar-view.tsx:80-83`

```tsx
useEffect(() => {
  if (hasRoot && tree.length === 0) void openRoot();   // openRoot 里 fs.openRoot() = showDirectoryPicker 弹窗
}, []);
```

**触发链**：`fs` 是 registry 里的单例（`root` 句柄在内存中保留）→ 打开文件夹后切到设置页 → 返回工作区 → SidebarView 卸载重挂载 → `useState(fs.hasRoot())` 得 `true`、`tree` 初始 `[]` → 该 effect 触发 `openRoot()` → **重新弹出「选择文件夹」对话框**（骚扰用户，且需重新授权）。

**根因**：把「恢复已打开根目录」误实现为「重新打开根目录」。恢复树只需 `readDir("")`，**不该**再次弹 `showDirectoryPicker`。

**修复**：挂载时若 `hasRoot`，调 `refreshTree()`（`readDir("")` 恢复树，保留不弹窗）；`openRoot()`（弹窗）只应由用户点「打开文件夹」按钮触发。

---

## 三、MINOR（可留）

- **m1** markdown 的 `fs` 用 `useMemo(..., [kernel])` 缓存——filesystem 驱动 reload 后 registry 里是新 fs 对象，但 markdown 的 `fs` 缓存旧引用（`useMemo` 依赖 `kernel` 不变）。v1 边缘场景。
- **m2** `filesystem:openFile` topic 在 App.tsx 硬编码字符串（`App.tsx:44`），与 markdown `events.ts` 的 `OPEN_FILE_TOPIC` 常量重复——已知限制（未抽共享协议包），改 topic 需三处同步。
- **m3** 打开文件后未保存直接点另一文件丢弃改动（报告已知限制）；无脏检查提示。
- **m4** `fs.ts` 的 `readFile`/`writeFile` 对同一 path 重复 `resolveSafePath`（`resolveDir` 内再校验一次），无害但冗余。

---

## 四、INFO（观察）

- **事件协议正确**：`isOpenFilePayload` 守卫（拒绝 null/非对象/缺 path）3 组用例；生产端 emit、消费端守卫，跨包零耦合（结构类型 `FileSystemOps`）。
- **竞态防护正确**（P0）：`openSeqRef` 序号，连续点击只应用最后一次 `readFile` 结果，过期 Promise 丢弃。
- **首次点击丢事件闭环正确**（P0）：sidebar 写 `lastOpenPath` + App 订阅切驱动；markdown 挂载补开 `lastOpenPath`——「从任意工作区点击 .md 都能打开」成立。
- **宿主 `.value` 正确**（P0）：markdown workspace 与 filesystem sidebar 均用 `registry.get(...).value`，无漏 `.value`。
- **hooks 纪律正确**（P1）：workspace-view / sidebar-view / App 新增的 useState/useEffect/useMemo 均在条件 return 之前。
- **依赖顺序正确**（P1）：DRIVERS 数组 filesystem → markdown → appearance；markdown manifest `dependencies: ["minex.filesystem"]`；filesystem 无依赖 → 无环。
- **路径安全正确**：`resolveSafePath` 拒绝绝对路径（`/`、盘符）与 `..` 逃逸，反斜杠规范化，5 组用例覆盖。
- **`drivers/minex.demo` 残留已删** ✓；根脚本 build/typecheck/drivers:sync 已纳入 filesystem-driver ✓。
- filesystem 的 `sidebar` 贡献使文件树常驻左栏（不依赖活动驱动），App 消费逻辑正确（`useMemo` 稳定）。

---

## 五、报告 21 验收逐条判定

| 标准 | 判定 |
|---|---|
| 三连全绿 | ❌ **typecheck 失败**（B1） |
| 点击 .md → 切到 markdown 并显示内容 | ✅（事件协议 + lastOpenPath 补开 + openSeqRef 竞态） |
| 编辑 → 保存 → 写回 + 刷新 | ✅（writeFile + fileSaved → refreshTree） |
| 从文件系统工作区点击 .md 仍能打开 | ✅（补开路径） |
| 快速连点两文件显示后一个 | ✅（openSeqRef） |

---

## 六、测试缺口

- `SidebarView` 无 React 渲染测试（M1「设置页往返重弹窗」漏检）。
- `fs.ts` 的 `readFile`/`writeFile` 无测试（File System Access API 依赖浏览器，难以单测，可接受）。
- `showDirectoryPicker` 类型缺失（B1）暴露「新包接浏览器 API 未核对类型」——与 report-17 B1（DOM lib）、report-20 B1（turndown）同类。

---

## 七、结论与修复优先级

本轮设计（事件协议、竞态防护、首次点击补开、路径安全、依赖顺序）都正确且有测试，事件协议是亮点（跨包零耦合 + 守卫）。**两个问题**：

1. **B1**（BLOCKER）补 `showDirectoryPicker` 类型（1 行声明或装 @types）。
2. **M1**（MAJOR）SidebarView 挂载时「恢复树」改用 `refreshTree()` 而非 `openRoot()`（约 2 行）——否则从设置页返回必弹窗。

**流程问题（第四次，且报告自己预警后仍发生）**：报告 21 明确写了「务必贴回三个命令的完整输出」，typecheck 依然失败且被提交为「全绿」。这已经不能归因于「不知道要跑 typecheck」——报告里都写了，是**验证 agent 没有执行报告要求**。建议：① 验证命令三连作为 CI/脚本硬门槛，不是靠 agent 自觉；② 若继续用人工/agent 验证，要求把 `npm run typecheck` 的**退出码和错误输出**作为「通过」的必要证据，而不是只回「全绿」。

**给学员的技术提示**：新增浏览器 API 依赖时，先确认 TS 类型来源——`FileSystemDirectoryHandle` 在标准 DOM lib，但 `showDirectoryPicker` 等 Picker 方法需要 `@types/wicg-file-system-access`。这已是第三次「新依赖/新 API 缺类型」导致 typecheck 失败（report-17 DOM lib、report-20 turndown、本轮 showDirectoryPicker）。
