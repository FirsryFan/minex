# 任务清单 · S5g（代码插槽：受限 DSL + 白名单解释器）

> 依据 `s5-agent-design.md`（第七章代码插槽）。核心：模型生成**声明式工作流数据**（非可执行代码），固定解释器执行，能力面 = 白名单操作注册表——**「代码强度不能被实施」**。
> 前置：解释器骨架可用 mock 操作独立实现 + 测试；真实操作桥接依赖 S5d（工具）/ S5e（信封+消息池）/ S5f（拓扑排序）。
> 验证三连：`npm run typecheck && npm run build && npm test`。

## 1. 工作流 DSL 类型 + 校验（src/workflow.ts，纯函数）
- `WorkflowNode = { id: string; op: string; args?: Record<string, unknown>; deps?: string[]; when?: Condition; loop?: boolean }`
- `Condition = { field: string; op: "eq" | "ne" | "gt" | "gte" | "lt" | "lte"; value: unknown }`（有限比较算子）
- `Workflow = { nodes: WorkflowNode[] }`
- `validateWorkflow(wf: Workflow, registry: OperationRegistry): void` —— 节点 id 唯一、`deps` 引用存在、`op` 在注册表、`loop` 节点必须受全局上限约束；违规抛错。

## 2. 操作注册表（src/operations.ts）
- `OperationRegistry = { register(name, fn): void; has(name): boolean; execute(name, args, ctx): Promise<unknown> }`
- 内置操作（桥接已注册能力，能力未就绪则注册时跳过）：
  - `callTool`（查 `tool` 能力）/ `readSession` / `writeSession`（查 `session` 能力）/ `sendEnvelope`（查 `envelope` 能力）/ `readPool` / `requestPoolWrite`（查 `pool` 能力）/ `localVar`（解释器内建存储）。
- 注册表可增删——后续 hook 明晰后增删操作，不推翻结构。

## 3. 解释器（src/interpreter.ts）
- `executeWorkflow(wf: Workflow, ctx, opts: { maxLoopIterations: number; registry: OperationRegistry }): Promise<Map<string, unknown>>`
  - `validateWorkflow` → 复用 S5f 的 `buildPlan`（deps 拓扑排序 + 环检测）→ 逐层逐节点执行。
  - 控制流内建：顺序（deps 分层）、条件（`when` 满足才执行，否则跳过）、循环（`loop: true` 节点重复执行直到 `when` 不满足或达 `maxLoopIterations`）。
  - **循环上限 `maxLoopIterations` 由用户/manager 配置传入**（manager 也是 agent，可能触发循环，故不写死）。
  - 结果按节点 id 返回 Map。

## 4. 安全边界（天然安全，无需运行时沙箱）
- 解释器**只查表调用操作 + 内建控制流**，不存在「执行任意代码」路径——eval / 动态 import / 网络 / 文件 / 全局访问根本不在解释器的能力面内。
- 模型生成的 workflow 数据只能引用注册表内的 `op`，未注册 op 被 `validateWorkflow` 拒绝。

## 5. 测试（test/workflow.test.ts / test/interpreter.test.ts，mock 操作）
- `validateWorkflow`：op 未注册拒绝 / deps 引用不存在 / 重复 id / loop 无上限。
- `executeWorkflow`（mock 操作）：顺序（无 deps）/ 依赖串行（复用调度器）/ 条件分支（when 满足/不满足）/ 循环（达上限停止）/ 结果 Map 键全。
- 安全：workflow 引用 `eval` 等未注册 op → 校验抛错。

## 验收
- 三连全绿。
- mock 场景：一份含「调用 echo 工具 + 条件分支 + 带上限循环」的 workflow 数据，解释器正确执行且循环达上限即停；引用 `eval` 被拒。
