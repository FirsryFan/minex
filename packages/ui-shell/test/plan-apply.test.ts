import { describe, expect, it } from "vitest";
import { planApply } from "../src/plan-apply.js";

// 依赖图：B 依赖 A；C 依赖 B
const deps: Record<string, string[]> = {
  a: [],
  b: ["a"],
  c: ["b"],
};

function getDeps(id: string): string[] {
  return deps[id] ?? [];
}

describe("planApply", () => {
  it("detects conflict: enabling a dependent while disabling its dependency", () => {
    const plan = planApply({ b: true, a: false }, getDeps);
    expect(plan.conflicts).toHaveLength(1);
    expect(plan.conflicts[0]).toContain('"b"');
    expect(plan.conflicts[0]).toContain('"a"');
  });

  it("detects transitive conflict: C enabled needs A (via B), A disabled", () => {
    const plan = planApply({ c: true, a: false }, getDeps);
    expect(plan.conflicts).toHaveLength(1);
    expect(plan.conflicts[0]).toContain('"a"');
  });

  it("no conflict for plain enables/disables", () => {
    const plan = planApply({ a: true, b: false }, getDeps);
    expect(plan.conflicts).toEqual([]);
  });

  it("disables run dependents-first", () => {
    const plan = planApply({ a: false, b: false, c: false }, getDeps);
    const order = plan.steps.map((s) => s.id);
    expect(order[0]).toBe("c"); // 依赖者先
    expect(order[order.length - 1]).toBe("a"); // 依赖最后
  });

  it("enables run dependencies-first", () => {
    const plan = planApply({ a: true, b: true, c: true }, getDeps);
    const order = plan.steps.map((s) => s.id);
    expect(order[0]).toBe("a");
    expect(order[order.length - 1]).toBe("c");
  });

  it("disables all run before enables all", () => {
    const plan = planApply({ a: false, b: true }, getDeps);
    const disables = plan.steps.filter((s) => !s.enabled);
    const enables = plan.steps.filter((s) => s.enabled);
    expect(plan.steps.indexOf(disables[disables.length - 1])).toBeLessThan(plan.steps.indexOf(enables[0]));
  });
});
