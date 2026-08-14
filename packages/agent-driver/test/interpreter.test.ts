import { describe, expect, it } from "vitest";
import type { DriverContext } from "@minex/kernel";
import driver from "../src/index.js";
import { executeWorkflow } from "../src/interpreter.js";
import { createBuiltinRegistry, createRegistry, type OperationRegistry } from "../src/operations.js";
import { echoTool } from "../src/tool.js";
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

  it("loop + when 前置：when 不满足 0 次", async () => {
    const r = createRegistry();
    let calls = 0;
    r.register("set", async (args) => args.value);
    r.register("tick", async () => {
      calls++;
      return calls;
    });
    const wf: Workflow = {
      nodes: [
        { id: "flag", op: "set", args: { value: false } },
        { id: "loop", op: "tick", loop: true, deps: ["flag"], when: { field: "flag", op: "eq", value: true } },
      ],
    };
    await executeWorkflow(wf, undefined, { maxLoopIterations: 5, registry: r });
    expect(calls).toBe(0); // when 不满足 → 前置 while 0 次
  });

  it("loop + when 自引用：正常循环 N 次后停（when 变假即停）", async () => {
    const r = createRegistry();
    let calls = 0;
    r.register("tick", async () => {
      calls++;
      return calls; // 第 n 次执行返回 n（迭代间唯一可变信号 = loop 自身结果，自引用）
    });
    // ne（不等）自引用：首轮 Number(undefined)=NaN 若用 gt/lt 恒假，故用 ne
    const wf: Workflow = {
      nodes: [{ id: "loop", op: "tick", loop: true, when: { field: "loop", op: "ne", value: 3 } }],
    };
    const results = await executeWorkflow(wf, undefined, { maxLoopIterations: 10, registry: r });
    expect(calls).toBe(3); // 首轮 undefined≠3 → 执行；第 4 轮 3≠3 → 停，共 3 次
    expect(results.get("loop")).toBe(3); // 停在最后一次执行结果
  });

  it("双层上限：传 1e9 在 absoluteMax 处停止", async () => {
    const r = createRegistry();
    let calls = 0;
    r.register("tick", async () => {
      calls++;
      return calls;
    });
    const wf: Workflow = { nodes: [{ id: "loop", op: "tick", loop: true }] };
    await executeWorkflow(wf, undefined, { maxLoopIterations: 1e9, absoluteMaxIterations: 3, registry: r });
    expect(calls).toBe(3); // effectiveMax = min(1e9, 3) = 3
  });

  it("条件跳过级联：A 被跳过 → 依赖 A 的 B 也跳过", async () => {
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
        { id: "flag", op: "set", args: { id: "flag", value: false } },
        { id: "a", op: "mark", args: { id: "a" }, deps: ["flag"], when: { field: "flag", op: "eq", value: true } },
        { id: "b", op: "mark", args: { id: "b" }, deps: ["a"] },
      ],
    };
    const results = await executeWorkflow(wf, undefined, { maxLoopIterations: 5, registry: r });
    expect(results.has("a")).toBe(false); // A 条件跳过
    expect(results.has("b")).toBe(false); // B 级联跳过
    expect(executed).not.toContain("b");
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

  it("workflow 接线：callTool 桥接 echo 工具（S5g 接线）", async () => {
    const ctx = { query: () => [echoTool], get: () => undefined };
    const registry = createBuiltinRegistry(ctx as never);
    const wf: Workflow = { nodes: [{ id: "a", op: "callTool", args: { name: "echo", args: { text: "hi" } } }] };
    const results = await executeWorkflow(wf, ctx, { maxLoopIterations: 5, registry });
    expect(results.get("a")).toBe("hi");
  });
});

describe("workflow 接线（index.ts 注册层：activate + workflow.run）", () => {
  interface WorkflowCap {
    run(wf: Workflow, opts?: { maxLoopIterations?: number }): Promise<Map<string, unknown>>;
  }

  /** 最小 DriverContext 桩：register 记录、query 只回 tool 能力、其余空实现。 */
  function makeDriverStub(): DriverContext {
    const registered = new Map<string, unknown>();
    return {
      manifest: { id: "minex.agent", name: "agent", version: "0.1.0" },
      register: (type, id, value) => {
        registered.set(`${type}/${id}`, value);
      },
      unregister: () => {},
      query: <T>(type: string): T[] => (type === "tool" ? ([echoTool] as unknown as T[]) : []),
      get: <T>(type: string, id: string): T | undefined => registered.get(`${type}/${id}`) as T | undefined,
      on: () => () => {},
      emit: () => {},
      storage: {
        get: () => undefined,
        set: () => {},
        delete: () => {},
        list: () => [],
      },
      log: { info: () => {}, warn: () => {}, error: () => {} },
    };
  }

  it("activate 注册 → 经 workflow.run 执行含 echo 工具的 workflow，结果 Map 键全", async () => {
    const ctx = makeDriverStub();
    await driver.activate(ctx);
    const workflow = ctx.get<WorkflowCap>("workflow", "default")!;
    const wf: Workflow = {
      nodes: [
        { id: "a", op: "callTool", args: { name: "echo", args: { text: "hi" } } },
        { id: "b", op: "callTool", args: { name: "echo", args: { text: "yo" } } },
      ],
    };
    const results = await workflow.run(wf);
    expect(results.get("a")).toBe("hi");
    expect(results.get("b")).toBe("yo");
    expect([...results.keys()].sort()).toEqual(["a", "b"]); // 结果 Map 键全
  });

  it("eval workflow 经 workflow.run 被拒（安全命题不回退）", async () => {
    const ctx = makeDriverStub();
    await driver.activate(ctx);
    const workflow = ctx.get<WorkflowCap>("workflow", "default")!;
    const wf: Workflow = { nodes: [{ id: "a", op: "eval", args: { code: "x" } }] };
    // run 内 validateWorkflow 同步抛错（注册层白名单无 eval）→ 用 toThrow 断言
    expect(() => workflow.run(wf)).toThrow(/未注册操作：eval/);
  });
});
