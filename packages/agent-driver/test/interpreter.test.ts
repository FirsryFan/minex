import { describe, expect, it } from "vitest";
import { createRegistry, type OperationRegistry } from "../src/operations.js";
import { executeWorkflow } from "../src/interpreter.js";
import type { Workflow } from "../src/workflow.js";

function makeRegistry(): OperationRegistry {
  const r = createRegistry();
  r.register("echo", async (args) => args.text ?? "");
  r.register("counter", async () => "tick"); // 无副作用，供循环
  return r;
}

describe("executeWorkflow", () => {
  it("顺序（无 deps）：全部执行", async () => {
    const wf: Workflow = { nodes: [{ id: "a", op: "echo", args: { text: "hi" } }] };
    const results = await executeWorkflow(wf, undefined, { maxLoopIterations: 5, registry: makeRegistry() });
    expect(results.get("a")).toBe("hi");
  });

  it("依赖串行（复用调度器）", async () => {
    const order: string[] = [];
    const r = createRegistry();
    r.register("log", async (args) => {
      order.push(String(args.id));
      return args.id;
    });
    const wf: Workflow = {
      nodes: [
        { id: "a", op: "log", args: { id: "a" } },
        { id: "b", op: "log", args: { id: "b" }, deps: ["a"] },
      ],
    };
    await executeWorkflow(wf, undefined, { maxLoopIterations: 5, registry: r });
    expect(order).toEqual(["a", "b"]);
  });

  it("条件分支：when 满足执行、不满足跳过", async () => {
    const r = createRegistry();
    const executed: string[] = [];
    r.register("set", async (args) => {
      executed.push(String(args.id));
      return args.value;
    });
    r.register("mark", async (args) => {
      executed.push(String(args.id));
      return true;
    });
    const wf: Workflow = {
      nodes: [
        { id: "flag", op: "set", args: { id: "flag", value: true } },
        { id: "yes", op: "mark", args: { id: "yes" }, deps: ["flag"], when: { field: "flag", op: "eq", value: true } },
        { id: "no", op: "mark", args: { id: "no" }, deps: ["flag"], when: { field: "flag", op: "eq", value: false } },
      ],
    };
    const results = await executeWorkflow(wf, undefined, { maxLoopIterations: 5, registry: r });
    expect(results.has("yes")).toBe(true);
    expect(results.has("no")).toBe(false); // 条件不满足跳过
  });

  it("循环：达上限停止", async () => {
    const r = createRegistry();
    let calls = 0;
    r.register("tick", async () => {
      calls++;
      return calls;
    });
    const wf: Workflow = { nodes: [{ id: "loop", op: "tick", loop: true }] };
    await executeWorkflow(wf, undefined, { maxLoopIterations: 3, registry: r });
    expect(calls).toBe(3);
  });

  it("结果 Map 键全", async () => {
    const wf: Workflow = { nodes: [{ id: "a", op: "echo", args: { text: "x" } }, { id: "b", op: "echo", args: { text: "y" } }] };
    const results = await executeWorkflow(wf, undefined, { maxLoopIterations: 5, registry: makeRegistry() });
    expect([...results.keys()].sort()).toEqual(["a", "b"]);
  });

  it("安全：引用未注册 op（eval）被 validateWorkflow 拒绝", async () => {
    const wf: Workflow = { nodes: [{ id: "a", op: "eval", args: { code: "x" } }] };
    await expect(executeWorkflow(wf, undefined, { maxLoopIterations: 5, registry: makeRegistry() })).rejects.toThrow(/未注册操作：eval/);
  });
});
