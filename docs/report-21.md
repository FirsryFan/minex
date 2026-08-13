# Minex 阶段报告 21（2026-08-13）—— markdown 适配 filesystem（打开/保存）+ 交接前清理

> 报告制度（固定四节）。本轮内容：文件树 .md 文件点击 → markdown 编辑器打开；编辑保存 → 写回文件 + 文件树刷新；markdown 驱动声明依赖 filesystem；清理 `drivers/` demo 残留产物、交接文档补 cli 索引。
> 前置：`docs/report-20.md` → `docs/review-phase20-report.md`。

---

## 一、上次问题回归

- report-20 无遗留 P0（上上轮 B1 漏 `.value` 已在 report-20 前置修复）。
- 回归面：markdown 四模式 / 快捷键 / 即时渲染的核心逻辑本轮未改，仅在其上叠加「打开 / 保存」两条路径；filesystem 文件树仅新增点击分发与刷新，目录展开/折叠逻辑未动。

---

## 二、本轮目标与内容

| # | 内容 | 定位 |
|---|---|---|
| 1 | 文件树点击 `.md` → markdown 编辑器打开 | `sidebar-view.tsx` 点击分发 + emit `filesystem:openFile`；`App.tsx` 订阅并自动切到 markdown 工作区 |
| 2 | 编辑 → 保存 → 写回文件 + 文件树刷新 | `workspace-view.tsx` 保存按钮 `writeFile` + emit `filesystem:fileSaved`；`sidebar-view.tsx` 订阅刷新根列表 |
| 3 | markdown 依赖 filesystem | `manifest.json` 加 `dependencies: ["minex.filesystem"]` |
| 4 | 事件协议纯函数 + 测试 | markdown `events.ts`（`isOpenFilePayload`）、filesystem `path.ts`（`isMarkdownFile`） |
| 5 | 交接前清理 | 删 `drivers/minex.demo` 残留；`handoff-project.md` 补 cli 包索引 |

---

## 三、具体实现

### 文件清单与联系

| 文件 | 职责 |
|---|---|
| `packages/filesystem-driver/src/path.ts` | 新增 `isMarkdownFile(name)`：扩展名 .md/.markdown（忽略大小写），隐藏文件/空扩展名为 false |
| `packages/filesystem-driver/src/sidebar-view.tsx` | 文件点击分发（目录→toggle；`.md`→记 `lastOpenPath` + emit openFile）；订阅 `fileSaved` 刷新根列表（保留展开态） |
| `packages/filesystem-driver/test/path.test.ts` | +`isMarkdownFile` 3 组用例（识别/拒绝/边界） |
| `packages/markdown-driver/src/events.ts` | 事件协议：`OPEN_FILE_TOPIC`/`FILE_SAVED_TOPIC` + payload 类型 + 守卫 `isOpenFilePayload`（纯函数） |
| `packages/markdown-driver/src/workspace-view.tsx` | 订阅 openFile + 挂载补开 `lastOpenPath`；`openPath`（竞态防护）/`saveDoc`；保存按钮 + 文件名/状态展示 |
| `packages/markdown-driver/test/events.test.ts` | +`isOpenFilePayload` 3 组用例（接受/非对象/null/缺 path） |
| `packages/markdown-driver/manifest.json` | `dependencies: ["minex.filesystem"]` |
| `packages/ui-shell/src/App.tsx` | 订阅 `filesystem:openFile` → `setActiveDriverId("minex.markdown")`（自动切工作区） |
| `docs/handoff-project.md` | 关键文件索引补 `packages/cli` 一行 |
| 删除 `drivers/minex.demo` | git-ignored 的同步产物残留（packages 已无 demo 包，`drivers:sync` 不再生成） |

### 数据流

```
文件树点击 .md → isMarkdownFile 校验
  → storage("minex.filesystem").set("lastOpenPath", path)   // 供 markdown 挂载时补开
  → emit("filesystem:openFile", { path })
      ├─ App 订阅 → setActiveDriverId("minex.markdown")     // 首次点击时 markdown 未挂载，靠切换后补开
      └─ markdown workspace 订阅 → readFile(path) → setDoc + setCurrentPath
编辑 → 保存按钮 → writeFile(path, doc) → emit("filesystem:fileSaved", { path })
  → sidebar 订阅 → 重新 readDir 根 + 保留展开态
```

### 关键设计

1. **事件协议 = 驱动间契约**：topic 字面量 + payload 守卫；markdown 用结构类型 `FileSystemOps`（只含 readFile/writeFile）接 filesystem 能力，不跨包 import 实现，打包零耦合。
2. **首次点击丢事件闭环**：文件树点击时 markdown 工作区可能未挂载（活动驱动非 markdown）。解法：sidebar 写 `lastOpenPath` + App 订阅自动切驱动；markdown workspace 挂载时读 `lastOpenPath` 补开，保证「从任意工作区点击 .md 都能打开」。
3. **竞态防护**：`openSeqRef` 序号，连续点击多个文件时只应用最后一次 `readFile` 结果，丢弃过期 Promise 结果。
4. **宿主视图 `.value`**：workspace/sidebar 均经 `kernel.registry.get<...>("filesystem","default").value` 取能力（宿主视图形态），沿用历史坑规避。
5. **hooks 纪律**：新增 useState/useEffect/useMemo 全部在组件顶层、条件 return 之前。

---

## 四、审查标准

### 必须通过（验证 agent 执行）

1. **`npm run typecheck && npm run build && npm test` 三连全绿**——务必**贴回三个命令的完整输出**（历史上多次只跑 test 漏掉类型错误）。新增测试：`isMarkdownFile` 3 组 + `isOpenFilePayload` 3 组。
2. 打开文件夹 → 点击 `.md` 文件 → 自动切到 Markdown 工作区并显示文件内容；点击 `.md` 之外的文件无动作。
3. 编辑内容 → 点保存 → 无报错，文件内容写回（再次打开可见）；未打开文件时保存按钮禁用。
4. 从文件系统工作区（markdown 未挂载）点击 `.md` → 仍能打开（`lastOpenPath` 补开路径）。
5. 快速连续点击两个 `.md` → 编辑器最终显示**后点击**的那个（竞态防护）。

### 重点审查

- **P0 事件时序**：App 切驱动与 markdown 挂载补开的先后；`openSeqRef` 竞态是否正确丢弃过期结果。
- **P0 宿主 `.value`**：workspace-view / sidebar-view 取 filesystem 能力是否遗漏 `.value`。
- **P1 React hooks**：新增 hooks 是否都在条件 return 前；有无条件调用。
- **P1 manifest 依赖**：markdown 声明依赖后，lifecycle 是否按 filesystem→markdown 顺序激活；filesystem 停用/缺失时 markdown 行为（workspace 中 `fs` 可能为 undefined，已用 `?.` 与 `if (!fs)` 保护）。
- **P1 CSS**：新增 `.md-file/.md-save/.md-save-msg` 无专门样式（`.md-toolbar` 已是 flex，可正常排布），保存按钮复用全局 `.btn`。

### 已知限制（勿误报）

- 打开文件后未保存直接点另一个文件 → 丢弃未保存改动（v1 无脏检查提示）。
- 保存仅写回内容；已展开子目录内的新增文件需重新折叠/展开才可见（刷新仅根级 + 保留展开态）。
- 编辑器 doc 同时写 local 存储（既有行为）；打开文件后 local 的 doc 被文件内容覆盖，与「保存到文件」是两条路径。
- File System Access API 写权限依赖浏览器授权；`writeFile` 失败仅在工具栏提示，不自动重试。
- 非 `.md` 文件点击无动作（v1 只适配 markdown）。
- 事件 topic 为各驱动字面量约定，未抽共享协议包（后续可考虑 `@minex/contracts`）。
- 文件系统 Node/Electron 实现、agent 驱动、链接系统等仍按 roadmap 留待后续。

---

**提交状态**：本轮改动未 git 提交（等审查通过后按流程小步提交 + push）。
