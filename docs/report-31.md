# Minex 阶段报告 31（2026-08-13）—— 多实例隔离实施（doc / openFile / lastOpenPath 按实例）

> 报告制度（固定四节）。本轮内容：落实 `docs/multi-view-isolation.md` 与 review-phase30 的精确定位——面板注入 `instanceId`，doc 存储、`filesystem:openFile` 定向、`lastOpenPath` 补开三者按实例隔离，解决「不同工作区 markdown 内容串扰」。
> 前置：`docs/report-30.md` → `docs/review-phase30-report.md`（任务视图无缺陷；多实例隔离给出五步实施逻辑）。

---

## 一、上次问题回归

- review-phase30 确认任务视图 UI 无缺陷、三连全绿。
- **多实例内容串扰**（三个全局单例）本轮修复 ✅：doc 固定 key / openFile 全局广播 / lastOpenPath 全局补开 → 全部按实例隔离。
- 回归面：三连保持全绿（本轮实测 18 文件 / 155 测试）。

---

## 二、本轮目标与内容

| # | 内容 | 定位 |
|---|---|---|
| 1 | 面板注入 instanceId | `renderPanel` 传 `instanceId`（面板 props 扩展 `instanceId?: number`，可选向后兼容） |
| 2 | doc 按实例命名空间 | markdown doc key → `doc@<instanceId>`；默认实例迁移旧 `doc` |
| 3 | openFile 定向 | payload 加 `targetInstanceId`；文件树/总览 emit 携带；markdown 消费端按实例过滤；App 切驱动按目标实例 |
| 4 | lastOpenPath 按实例 | 写/读 `lastOpenPath@<instanceId>` |
| 5 | reload 运行时占用（待办） | 设计已定（multi-view-isolation.md），需 SettingsPage↔instances 跨层，改动大，标记待办 |

---

## 三、具体实现

### 文件清单与联系

| 文件 | 职责 |
|---|---|
| `markdown-driver/src/events.ts` | `OpenFilePayload` 加 `targetInstanceId?: number` |
| `ui-shell/src/App.tsx` | `renderPanel` 注入 `instanceId`；panelLazy 类型扩展；openFile 订阅按 `targetInstanceId` 切目标实例驱动 |
| `markdown-driver/src/workspace-view.tsx` | props `instanceId`；`docKey = doc@<id>` + `readInitialDoc`（迁移旧 doc）；openFile 订阅过滤非本实例；lastOpenPath 按实例 |
| `filesystem-driver/src/sidebar-view.tsx` | props `instanceId`；写 `lastOpenPath@<id>`；emit `{ path, targetInstanceId }` |
| `session-driver/src/overview-view.tsx` | props `instanceId`；emit `{ path, targetInstanceId }` |

### 关键代码定位（file:line，供审查对照）

| 改动点 | 定位 |
|---|---|
| payload 定向字段 | `markdown-driver/src/events.ts:10-12` |
| renderPanel 注入 instanceId | `ui-shell/src/App.tsx:213-221` |
| App openFile 定向切驱动 | `ui-shell/src/App.tsx:79-90` |
| docKey + 迁移 | `markdown-driver/src/workspace-view.tsx:75-76 / 304-316` |
| openFile 过滤 | `markdown-driver/src/workspace-view.tsx:107-112` |
| lastOpenPath 按实例 | `markdown-driver/src/workspace-view.tsx:123` / `filesystem-driver/src/sidebar-view.tsx:66` |
| sidebar/overview emit 定向 | `filesystem-driver/src/sidebar-view.tsx:67` / `session-driver/src/overview-view.tsx:60-64` |

### 数据流

```
文件树（实例 X）点击 .md → 写 lastOpenPath@X → emit { path, targetInstanceId: X }
  → App 订阅：切实例 X 的 activeDriverId = markdown
  → markdown workspace（实例 X）订阅：targetInstanceId === X → openPath；实例 Y 面板忽略
doc：实例 X 面板读写 doc@X（独立缓冲）；默认实例迁移旧 doc
```

### 关键设计

1. **instanceId 作为面板 props**（可选）：无实例概念的面板忽略；markdown/文件树/总览用它隔离。
2. **事件定向向后兼容**：`targetInstanceId` 缺省 = 广播（单实例行为不变）。
3. **doc 迁移**：默认实例（`doc@0`）缺失时回退读旧 `doc`，已有内容不丢。
4. **App 切驱动按目标实例**：文件树/总览属于某实例 → 只切该实例的 markdown 驱动。

---

## 四、审查标准

### 必须通过（已亲自验证，外部复核）

1. 三连全绿：`typecheck exit 0`（7 包）／`build exit 0`／`test 155/155`（18 文件）。
2. **多实例内容隔离**：工作区 A 与 B 的 markdown 各开不同文件/内容，互不覆盖（doc@id 隔离）。
3. 实例 A 文件树点击打开文件 → 仅实例 A 的 markdown 打开（targetInstanceId 定向）；实例 B 不变。
4. 各实例挂载补开各自上次打开的文件（lastOpenPath@id）。

### 重点审查

- **P0 定向正确性**：`targetInstanceId !== instanceId` 忽略；缺省广播兼容单实例。
- **P0 doc 迁移**：默认实例回退旧 doc；`doc@0` 优先。
- **P1 App 切驱动**：openFile 定向切目标实例（非当前实例）的 activeDriverId。
- **P1 面板 props 兼容**：非 markdown 面板（如总览/文件树）instanceId 可选，忽略无影响。

### 已知限制 / 待办（勿误报）

- **第 5 步（reload 运行时占用检查）待办**：需 SettingsPage ↔ instances 跨层状态（plan-apply 无法访问实例 dockState），设计已定（`multi-view-isolation.md` 第五节），后续实施。
- 会话库仍全局共享（多实例打开同一 `.ses` 有写竞态，v1 最后写者胜）。
- 实例状态（dockState/floatingPos/doc）不持久化到 localStorage（刷新重置）。

---

**提交状态**：本轮改动独立提交：`feat(ui/mist): 多实例隔离（doc / openFile 定向 / lastOpenPath 按实例）`。
