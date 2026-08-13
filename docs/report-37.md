# Minex 阶段报告 37（2026-08-13）—— 阶段 36 审查修复（onEnvelope 重复订阅）

> 报告制度（固定四节）。本轮内容：执行 `review-phase36-report.md`——仅 1 处 MINOR（onEnvelope `*` 重复订阅），高效修复。无 BLOCKER/MAJOR。
> 前置：`docs/report-36.md` → `docs/review-phase36-report.md`。

---

## 一、上次问题回归

- review-phase36 无 BLOCKER/MAJOR，仅 MINOR-1（onEnvelope(bus,"*",cb) 重复订阅）。
- **MINOR-1 已修** ✅：`onEnvelope` 用 `new Set` 去重 topic（`to==="*"` 时定向与广播退化为同一 topic，去重后只订阅一次）。
- 回归面：三连保持全绿（本轮实测 24 文件 / 203 测试）。

---

## 二、本轮目标与内容

| # | 内容 | 定位 |
|---|---|---|
| 1 | MINOR-1 onEnvelope 去重 | `envelope.ts` `new Set` 去 topic |
| 2 | 防回归测试 | `envelope.test.ts` 加 `onEnvelope(bus,"*",cb)` 单次触发用例 |

---

## 三、具体实现

### 关键代码定位（file:line，供审查对照）

| 改动点 | 定位 |
|---|---|
| onEnvelope topic 去重 | `agent-driver/src/envelope.ts:71-75` |
| 防回归测试 | `agent-driver/test/envelope.test.ts:62-67` |

### 关键设计

1. **`new Set` 去重**：`onEnvelope` 订阅 `${prefix}:${to}` 与 `${prefix}:*`，`to==="*"` 时两 topic 相同，`Set` 去重后各订阅一次——广播回调不重复触发。

---

## 四、审查标准

### 必须通过（已亲自验证，外部复核）

1. 三连全绿：`typecheck exit 0`（9 包）／`build exit 0`／`test 203/203`（24 文件）。
2. `onEnvelope(bus,"*",cb)` 广播只触发一次；正常 `to`（具体 agent id）行为不变。

### 已知限制 / INFO（勿误报，沿用 review-phase36）

- INFO-2/4/7（to 字符集校验 / send 旁路 serialize / payload 可序列化）—— 进程内纯数据层可留，跨进程信封时处理。
- INFO-5（manager 独占写权限）/ INFO-6（pool 命名空间）—— 属 S5f 调度器/编排层范畴。
- report-36 测试计数误差（envelope 实为 8 用例，非 7）—— 文档计数，非代码缺陷。

---

**提交状态**：本轮改动独立提交：`fix(agent): 阶段36审查修复（onEnvelope 重复订阅去重）`。
