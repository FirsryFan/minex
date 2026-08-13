# Minex 阶段报告 38（2026-08-13）—— S5f：调度器（依赖拓扑排序 + 并行）

> 报告制度（固定四节）。本轮内容：按 `docs/task-s5f.md` 完成调度器——buildPlan（依赖分层 + 环检测 + 启发式排序）+ execute（层内并行 + 限流 + 结果 Map）。
> 前置：`docs/report-37.md` → `docs/task-s5f.md`。

---

## 一、上次问题回归

- review-phase36 的 MINOR-1（onEnvelope 重复订阅）已在 report-37 修复，本轮无回归。
- 回归面：三连保持全绿（本轮实测 25 文件 / 216 测试）。

---

## 二、本轮目标与内容

| # | 内容 | 定位 |
|---|---|---|
| 1 | 类型 | `scheduler.ts`：Task / ScheduleStep / Heuristic |
| 2 | buildPlan | 依赖拓扑分层 + 环检测 + 启发式排序（纯函数） |
| 3 | verifyPlan | 校验 plan 覆盖 + 依赖序（可选） |
| 4 | execute | 层内并行（maxConcurrent 限流）+ 层间串行 + 结果 Map + 失败继续 |
| 5 | 测试 | scheduler 14 用例 |

---

## 三、具体实现

### 文件清单与联系

| 文件 | 职责 |
|---|---|
| `agent-driver/src/scheduler.ts` | Task/ScheduleStep/Heuristic 类型 + buildPlan/verifyPlan/execute |
| `agent-driver/test/scheduler.test.ts` | 14 用例 |

### 关键代码定位（file:line，供审查对照）

| 改动点 | 定位 |
|---|---|
| Task / ScheduleStep / Heuristic | `agent-driver/src/scheduler.ts:7-19` |
| 默认启发式（priority→estimatedTime） | `agent-driver/src/scheduler.ts:22-29` |
| buildPlan（Kahn 拓扑 + 环检测） | `agent-driver/src/scheduler.ts:36-71` |
| verifyPlan | `agent-driver/src/scheduler.ts:74-84` |
| execute（分批并行 + 失败继续） | `agent-driver/src/scheduler.ts:92-120` |

### 数据流

```
buildPlan(tasks)：Kahn 拓扑分层 → [[无依赖层], [依赖满足层], ...] → 同层启发式排序
execute(tasks, run)：buildPlan → 逐层 Promise.all（maxConcurrent 分批）→ 结果 Map<id, R>
```

### 关键设计

1. **Kahn 算法分层**：indegree（未满足依赖数）入队 + 逐层剥离；环检测 = processed < total（indegree>0 的任务无法入队，抛错附 id）。
2. **默认贪心启发式**：priority 降序 → estimatedTime 降序（关键路径优先简化），可注入自定义 Heuristic。
3. **层内并行 + 限流**：`maxConcurrent` 分批（默认 Infinity 整层并行）；层间串行保证依赖序。
4. **结果 Map + 失败继续**：结果按 task id 存 Map（缓存友好）；单任务失败捕获、记录 undefined、不中断整层。

---

## 四、审查标准

### 必须通过（已亲自验证，外部复核）

1. 三连全绿：`typecheck exit 0`（9 包）／`build exit 0`／`test 216/216`（25 文件，新增 scheduler 14）。
2. `buildPlan`：无依赖单层 / 链式三层 / 树 / 环检测抛错 / priority+estimatedTime 排序 / 自定义 heuristic。
3. `execute`：无依赖并行（耗时≈最慢非求和）/ 有依赖串行 / 结果 Map 键全 / maxConcurrent 限流 / 单任务失败不中断。

### 重点审查

- **P0 环检测**：依赖无法满足时抛错附环上 id；不误报（合法 DAG 不抛）。
- **P0 并行正确性**：层内并行、层间串行；依赖任务一定在其依赖完成后执行。
- **P1 启发式**：priority 降序优先于 estimatedTime 降序；自定义 comparator 生效。
- **P1 失败语义**：单任务失败不中断；失败值 undefined；其他任务结果正常。

### 已知限制（勿误报）

- 失败任务结果存 `undefined`（`as unknown as R`），调用方需自判；无独立错误对象。
- `weight` 字段已建模但默认启发式未用（预留，后续贪心权重可扩展）。
- `execute` 无并发上限的全局熔断（仅 per-layer maxConcurrent）；超大任务集需调度层控制。
- 调度器为纯算法，未接入 agent loop 或信封（S5f 后续编排层整合）。

---

**提交状态**：本轮改动独立提交：`feat(agent): S5f 调度器（依赖拓扑排序 + 并行）`。
