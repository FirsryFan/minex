# Minex 阶段报告 40（2026-08-13）—— S5g：代码插槽（受限 DSL + 白名单解释器）

> 报告制度（固定四节）。本轮内容：按 `docs/task-s5g.md` 完成代码插槽——工作流 DSL 类型 + 校验、白名单操作注册表、解释器（复用调度器 + 内建控制流）。
> 前置：`docs/report-39.md` → `docs/task-s5g.md`。

---

## 一、上次问题回归

- review-phase38 的 MINOR-1/2 + INFO-4 已在 report-39 修复，本轮无回归。
- 回归面：三连保持全绿（本轮实测 27 文件 / 232 测试）。

---

## 二、本轮目标与内容

| # | 内容 | 定位 |
|---|---|---|
| 1 | DSL 类型 + 校验 | `workflow.ts`：WorkflowNode/Condition/Workflow + validateWorkflow + evalCondition |
| 2 | 操作注册表 | `operations.ts`：OperationRegistry + createRegistry + createBuiltinRegistry（能力桥接） |
| 3 | 解释器 | `interpreter.ts`：executeWorkflow（复用 buildPlan + 条件/循环控制流） |
| 4 | 测试 | workflow 8 用例 + interpreter 6 用例 |

---

## 三、具体实现

### 文件清单与联系

| 文件 | 职责 |
|---|---|
| `agent-driver/src/workflow.ts` | DSL 类型 + validateWorkflow（id/deps/op/loop 校验）+ evalCondition（有限算子） |
| `agent-driver/src/operations.ts` | OperationRegistry（register/has/execute）+ createBuiltinRegistry（桥接 tool/session/envelope/pool + localVar） |
| `agent-driver/src/interpreter.ts` | executeWorkflow（validate → buildPlan → 逐层执行 + 条件/循环） |
| `agent-driver/test/workflow.test.ts` + interpreter.test.ts | 14 用例 |

### 关键代码定位（file:line，供审查对照）

| 改动点 | 定位 |
|---|---|
| WorkflowNode/Condition/Workflow | `agent-driver/src/workflow.ts:10-27` |
| validateWorkflow（id/deps/op/loop） | `agent-driver/src/workflow.ts:38-60` |
| evalCondition（有限算子） | `agent-driver/src/workflow.ts:67-83` |
| OperationRegistry | `agent-driver/src/operations.ts:11-31` |
| createBuiltinRegistry（能力桥接） | `agent-driver/src/operations.ts:39-92` |
| executeWorkflow（复用 buildPlan + 控制流） | `agent-driver/src/interpreter.ts:21-51` |

### 数据流

```
executeWorkflow(wf, ctx, { maxLoopIterations, registry })
  → validateWorkflow（op 白名单 / deps / loop 上限）
  → 转 Task[] → buildPlan（deps 拓扑 + 环检测）
  → 逐层逐节点：条件（when 不满足跳过）/ 循环（loop 直到 when 不满足或达上限）
  → 结果 Map<节点id, value>
```

### 关键设计

1. **声明式数据 + 固定解释器**：模型只产出 Workflow 数据，解释器只查表调用白名单操作——不存在 eval/import/网络/文件/全局访问路径，天然安全，无需运行时沙箱。
2. **白名单注册表**：`validateWorkflow` 拒绝未注册 op（如 `eval`）；`createBuiltinRegistry` 桥接已注册能力（能力未就绪跳过），可增删不推翻结构。
3. **复用调度器**：`executeWorkflow` 调 S5f `buildPlan`（deps 拓扑 + 环检测），控制流内建（顺序/条件/循环）。
4. **循环上限由用户/manager 传入**：`maxLoopIterations` 不写死（manager 也是 agent，可能触发循环）。

---

## 四、审查标准

### 必须通过（已亲自验证，外部复核）

1. 三连全绿：`typecheck exit 0`（9 包）／`build exit 0`／`test 232/232`（27 文件，新增 workflow 8 + interpreter 6）。
2. `validateWorkflow`：op 未注册（eval）/ deps 不存在 / 重复 id / loop 无上限 均拒绝。
3. `executeWorkflow`：顺序 / 依赖串行 / 条件分支 / 循环达上限 / 结果 Map 键全 / 安全拒绝 eval。

### 重点审查

- **P0 白名单**：未注册 op（尤其 eval/new Function/import）被 validateWorkflow 拒绝；解释器无任意代码路径。
- **P0 循环上限**：loop 节点受 maxLoopIterations 约束，达上限停止。
- **P1 复用调度器**：deps 拓扑 + 环检测正确（复用 S5f 已验证的 buildPlan）。
- **P1 能力桥接**：createBuiltinRegistry 能力未就绪跳过；localVar 内建存储跨节点共享。

### 已知限制（勿误报）

- `requestPoolWrite` 桥接为直接写（manager 独占写由编排层保证，此处仅桥接能力）。
- `readSession/writeSession` 桥接依赖 session 能力就绪（S5d 阶段 session 驱动已交付，但桥接未在 index.ts 接线）。
- DSL 无「任意表达式/递归函数」能力（有限比较算子 + 白名单操作），属设计目标（代码强度不能被实施）。
- `createBuiltinRegistry` 尚未在 agent-driver index.ts 注册为能力（桥接函数已就绪，编排层整合时接线）。

---

**提交状态**：本轮改动独立提交：`feat(agent): S5g 代码插槽（受限 DSL + 白名单解释器）`。
