import { describe, expect, it } from "vitest";
import { buildPlan, execute, verifyPlan, type Task } from "../src/scheduler.js";

const t = (id: string, deps: string[] = [], extra: Partial<Task> = {}): Task => ({ id, deps, payload: undefined, ...extra });

describe("buildPlan", () => {
  it("无依赖：单层", () => {
    const plan = buildPlan([t("a"), t("b"), t("c")]);
    expect(plan).toHaveLength(1);
    expect(plan[0].map((s) => s.task.id).sort()).toEqual(["a", "b", "c"]);
  });
  it("链式 A←B←C：三层", () => {
    const plan = buildPlan([t("a"), t("b", ["a"]), t("c", ["b"])]);
    expect(plan.map((s) => s.map((x) => x.task.id))).toEqual([["a"], ["b"], ["c"]]);
  });
  it("树：a 依赖无，b/c 依赖 a", () => {
    const plan = buildPlan([t("a"), t("b", ["a"]), t("c", ["a"])]);
    expect(plan).toHaveLength(2);
    expect(plan[0].map((x) => x.task.id)).toEqual(["a"]);
    expect(plan[1].map((x) => x.task.id).sort()).toEqual(["b", "c"]);
  });
  it("环检测抛错（附环上任务）", () => {
    expect(() => buildPlan([t("a", ["b"]), t("b", ["a"])])).toThrow(/循环依赖/);
  });
  it("同层排序：priority 降序 → estimatedTime 降序", () => {
    const plan = buildPlan([
      t("a", [], { priority: 1 }),
      t("b", [], { priority: 3 }),
      t("c", [], { priority: 1, estimatedTime: 5 }),
      t("d", [], { priority: 1, estimatedTime: 9 }),
    ]);
    expect(plan[0].map((x) => x.task.id)).toEqual(["b", "d", "c", "a"]);
  });
  it("自定义 heuristic", () => {
    const plan = buildPlan([t("a"), t("b"), t("c")], (x, y) => x.id.localeCompare(y.id));
    expect(plan[0].map((x) => x.task.id)).toEqual(["a", "b", "c"]);
  });
});

describe("verifyPlan", () => {
  it("合法 plan 返回 true", () => {
    const tasks = [t("a"), t("b", ["a"]), t("c", ["a"])];
    const plan = buildPlan(tasks);
    expect(verifyPlan(tasks, plan)).toBe(true);
  });
  it("缺失任务返回 false", () => {
    const tasks = [t("a"), t("b", ["a"])];
    const plan = buildPlan([t("a")]); // 只含 a
    expect(verifyPlan(tasks, plan)).toBe(false);
  });
});

describe("execute", () => {
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  it("无依赖并行：总耗时 ≈ 最慢者，非求和", async () => {
    const start = Date.now();
    await execute([t("a"), t("b"), t("c")], async () => {
      await sleep(20);
      return 1;
    });
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(55); // 并行 ≈20ms，串行会 ≥60ms
  });

  it("有依赖串行", async () => {
    const order: string[] = [];
    await execute([t("a"), t("b", ["a"]), t("c", ["b"])], async (task) => {
      await sleep(5);
      order.push(task.id);
      return task.id;
    });
    expect(order).toEqual(["a", "b", "c"]);
  });

  it("结果 Map 键全", async () => {
    const results = await execute([t("a"), t("b", ["a"]), t("c")], async (task) => task.id.toUpperCase());
    expect([...results.keys()].sort()).toEqual(["a", "b", "c"]);
    expect(results.get("a")).toBe("A");
  });

  it("maxConcurrent 限流：串行执行", async () => {
    const start = Date.now();
    await execute([t("a"), t("b"), t("c")], async () => {
      await sleep(15);
      return 1;
    }, { maxConcurrent: 1 });
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(40); // 3×15 串行
  });

  it("单任务失败不中断整层", async () => {
    const results = await execute([t("a"), t("b"), t("c")], async (task) => {
      if (task.id === "b") throw new Error("boom");
      return task.id;
    });
    expect(results.get("a")).toBe("a");
    expect(results.get("b")).toBeUndefined(); // 失败记录 undefined
    expect(results.get("c")).toBe("c");
  });
});
