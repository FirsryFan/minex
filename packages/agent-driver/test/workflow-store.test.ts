import { describe, expect, it } from "vitest";
import { createInMemoryStorage, createKernel } from "@minex/kernel";
import {
  deleteWorkflow,
  loadWorkflows,
  saveWorkflow,
  workflowsFromRaw,
} from "../src/workflow-store.js";
import type { Workflow } from "../src/workflow.js";

function wf(extra: Partial<Workflow> = {}): Workflow {
  return { nodes: [{ id: "n1", op: "localVar", args: { op: "set", key: "v", value: "hello" } }], ...extra };
}

describe("workflow-store（W-C 容错）", () => {
  it("正常存取：save/load/delete 按 id 合并", () => {
    const kernel = createKernel({ storage: createInMemoryStorage() });
    saveWorkflow(kernel, "wf-a", wf());
    saveWorkflow(kernel, "wf-b", wf({ nodes: [{ id: "x", op: "callTool" }] }));
    const all = loadWorkflows(kernel);
    expect(Object.keys(all).sort()).toEqual(["wf-a", "wf-b"]);
    expect(all["wf-b"].nodes[0].op).toBe("callTool");
    deleteWorkflow(kernel, "wf-a");
    expect(Object.keys(loadWorkflows(kernel))).toEqual(["wf-b"]);
  });

  it("损坏 JSON → {}（不抛错）；非法条目跳过", () => {
    const kernel = createKernel({ storage: createInMemoryStorage() });
    kernel.storage.namespace("minex.agent").set("workflows", "{bad json");
    expect(loadWorkflows(kernel)).toEqual({});
    kernel.storage.namespace("minex.agent").set("workflows", { good: wf(), bad: { noNodes: true } });
    expect(Object.keys(loadWorkflows(kernel))).toEqual(["good"]);
  });

  it("workflowsFromRaw 纯函数：非对象 / 空 / 过滤", () => {
    expect(workflowsFromRaw(undefined)).toEqual({});
    expect(workflowsFromRaw("x")).toEqual({});
    expect(workflowsFromRaw({ a: wf(), b: 1, c: { nodes: "no" } })).toEqual({ a: wf() });
  });
});
