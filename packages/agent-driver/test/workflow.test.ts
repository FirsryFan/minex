import { describe, expect, it } from "vitest";
import { evalCondition, validateWorkflow, type Workflow } from "../src/workflow.js";

const registry = {
  has: (name: string) => ["echo", "localVar", "sendEnvelope"].includes(name),
};

describe("validateWorkflow", () => {
  it("合法 workflow 通过", () => {
    const wf: Workflow = { nodes: [{ id: "a", op: "echo", args: { text: "hi" } }] };
    expect(() => validateWorkflow(wf, registry)).not.toThrow();
  });
  it("op 未注册拒绝（如 eval）", () => {
    const wf: Workflow = { nodes: [{ id: "a", op: "eval", args: { code: "..." } }] };
    expect(() => validateWorkflow(wf, registry)).toThrow(/未注册操作：eval/);
  });
  it("deps 引用不存在", () => {
    const wf: Workflow = { nodes: [{ id: "a", op: "echo", deps: ["nonexistent"] }] };
    expect(() => validateWorkflow(wf, registry)).toThrow(/依赖不存在/);
  });
  it("重复 id", () => {
    const wf: Workflow = { nodes: [{ id: "a", op: "echo" }, { id: "a", op: "echo" }] };
    expect(() => validateWorkflow(wf, registry)).toThrow(/id 重复/);
  });
  it("loop 无上限拒绝", () => {
    const wf: Workflow = { nodes: [{ id: "a", op: "echo", loop: true }] };
    expect(() => validateWorkflow(wf, registry, {})).toThrow(/maxLoopIterations/);
    expect(() => validateWorkflow(wf, registry, { maxLoopIterations: 3 })).not.toThrow();
  });
  it("when.field 引用不存在的节点 → 抛错", () => {
    const wf: Workflow = { nodes: [{ id: "a", op: "echo", when: { field: "nonexistent", op: "eq", value: 1 } }] };
    expect(() => validateWorkflow(wf, registry, { maxLoopIterations: 3 })).toThrow(/when.field/);
  });
});

describe("evalCondition", () => {
  const results = new Map<string, unknown>([["n", 5]]);
  it("eq / ne", () => {
    expect(evalCondition({ field: "n", op: "eq", value: 5 }, results)).toBe(true);
    expect(evalCondition({ field: "n", op: "ne", value: 3 }, results)).toBe(true);
  });
  it("gt / gte / lt / lte", () => {
    expect(evalCondition({ field: "n", op: "gt", value: 4 }, results)).toBe(true);
    expect(evalCondition({ field: "n", op: "gte", value: 5 }, results)).toBe(true);
    expect(evalCondition({ field: "n", op: "lt", value: 6 }, results)).toBe(true);
    expect(evalCondition({ field: "n", op: "lte", value: 5 }, results)).toBe(true);
  });
  it("数值比较：'10' gt '9' → true（审查数值语义）", () => {
    const r = new Map<string, unknown>([["n", "10"]]);
    expect(evalCondition({ field: "n", op: "gt", value: "9" }, r)).toBe(true);
  });
});
