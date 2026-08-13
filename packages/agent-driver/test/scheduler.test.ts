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
  it("依赖缺失报「依赖缺失」而非「循环依赖」（审查 MINOR-2）", () => {
    expect(() => buildPlan([t("a", ["nonexistent"])])).toThrow(/依赖缺失：a → nonexistent/);
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

  it("无依赖并行（并发计数，非 wall-clock）", async () => {
    let active = 0;
    let maxActive = 0;
    await execute([t("a"), t("b"), t("c")], async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await sleep(20);
      active--;
      return 1;
    });
    expect(maxActive).toBeGreaterThanOrEqual(2); // 无依赖 → 并行
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

  it("maxConcurrent 限流：并发不超过 1（串行）", async () => {
    let active = 0;
    let maxActive = 0;
    await execute([t("a"), t("b"), t("c")], async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await sleep(15);
      active--;
      return 1;
    }, { maxConcurrent: 1 });
    expect(maxActive).toBe(1); // 限流 → 串行
  });

  it("单任务失败不中断整层（失败存 Error，审查 MINOR-1）", async () => {
    const results = await execute([t("a"), t("b"), t("c")], async (task) => {
      if (task.id === "b") throw new Error("boom");
      return task.id;
    });
    expect(results.get("a")).toBe("a");
    expect(results.get("b")).toBeInstanceOf(Error); // 失败存 Error，可精确判定
    expect(results.get("c")).toBe("c");
  });
  it("成功返回 undefined 与失败可区分（审查 MINOR-1）", async () => {
    const results = await execute([t("ok"), t("fail")], async (task) => {
      if (task.id === "fail") throw new Error("x");
      return undefined;
    });
    expect(results.get("ok")).toBeUndefined(); // 成功返回 undefined
    expect(results.get("fail")).toBeInstanceOf(Error); // 失败是 Error
  });
  it("混合场景：B 在 A 后、C 与 A 并行（审查 INFO-4）", async () => {
    const order: string[] = [];
    let active = 0;
    let maxActive = 0;
    await execute([t("a"), t("b", ["a"]), t("c")], async (task) => {
      active++;
      maxActive = Math.max(maxActive, active);
      if (task.id === "a") await sleep(20);
      if (task.id === "b") await sleep(10);
      if (task.id === "c") await sleep(20);
      active--;
      order.push(task.id);
      return task.id;
    });
    expect(order.indexOf("b")).toBeGreaterThan(order.indexOf("a")); // B 在 A 后
    expect(order.indexOf("c")).toBeLessThan(order.indexOf("b")); // C 与 A 同层（先于 B 完成）
    expect(maxActive).toBeGreaterThanOrEqual(2); // A 与 C 并行
  });
});
