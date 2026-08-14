import { describe, expect, it } from "vitest";
import { createRegistry } from "../src/index.js";

describe("capability registry", () => {
  it("registers and queries", () => {
    const r = createRegistry();
    r.register("tool", "a", 1, { driverId: "p1" });
    r.register("tool", "b", 2, { driverId: "p2" });
    expect(r.query("tool")).toHaveLength(2);
    expect(r.get("tool", "a")?.value).toBe(1);
    expect(r.query("tool")[0].driverId).toBe("p1"); // priority 相等时先注册者先（稳定排序）
  });

  it("filters by driver", () => {
    const r = createRegistry();
    r.register("tool", "a", 1, { driverId: "p1" });
    r.register("tool", "b", 2, { driverId: "p2" });
    const fromP1 = r.query("tool", { driver: "p1" });
    expect(fromP1).toHaveLength(1);
    expect(fromP1[0].id).toBe("a");
  });

  it("priority wins on conflict", () => {
    const r = createRegistry();
    r.register("tool", "x", "low", { driverId: "p1", priority: 0 });
    r.register("tool", "x", "high", { driverId: "p2", priority: 10 });
    expect(r.get("tool", "x")?.value).toBe("high");
    // 低优先级尝试覆盖高优先级 → 拒绝
    r.register("tool", "x", "should-fail", { driverId: "p3", priority: 5 });
    expect(r.get("tool", "x")?.value).toBe("high");
    // 同 id 查询时高优先级排前面
    expect(r.query("tool")[0].value).toBe("high");
  });

  it("unregisters and notifies onChange", () => {
    const r = createRegistry();
    const events: string[] = [];
    const off = r.onChange("tool", (c) => events.push(`${c.action}:${c.id}`));
    r.register("tool", "a", 1, { driverId: "p1" });
    r.unregister("tool", "a");
    off();
    r.register("tool", "b", 2, { driverId: "p1" });
    expect(events).toEqual(["registered:a", "unregistered:a"]);
  });

  it("unregisterByDriver removes everything from a driver", () => {
    const r = createRegistry();
    r.register("tool", "a", 1, { driverId: "p1" });
    r.register("tool", "b", 2, { driverId: "p1" });
    r.register("tool", "c", 3, { driverId: "p2" });
    r.unregisterByDriver("p1");
    expect(r.query("tool")).toHaveLength(1);
    expect(r.get("tool", "c")?.value).toBe(3);
  });

  it("same priority + same driver re-registration updates value", () => {
    const r = createRegistry();
    r.register("tool", "x", 1, { driverId: "p1" });
    r.register("tool", "x", 2, { driverId: "p1" }); // 同驱动重注册 = 更新
    expect(r.get("tool", "x")?.value).toBe(2);
  });

  it("m1: same-driver priority downgrade is allowed", () => {
    const r = createRegistry();
    r.register("tool", "x", "high", { driverId: "p1", priority: 10 });
    r.register("tool", "x", "low", { driverId: "p1", priority: 0 }); // 同驱动降级
    expect(r.get("tool", "x")?.value).toBe("low");
    expect(r.get("tool", "x")?.priority).toBe(0);
  });

  it("same priority + different driver: first registrant wins", () => {
    const r = createRegistry();
    r.register("tool", "x", "first", { driverId: "p1" });
    r.register("tool", "x", "second", { driverId: "p2" }); // 同优先级不同驱动 → 拒绝
    expect(r.get("tool", "x")?.value).toBe("first");
  });

  it("NaN priority defaults to 0", () => {
    const r = createRegistry();
    r.register("tool", "a", 1, { driverId: "p1", priority: Number.NaN });
    r.register("tool", "b", 2, { driverId: "p2", priority: 1 });
    expect(r.get("tool", "a")?.priority).toBe(0);
    expect(r.query("tool")[0].id).toBe("b"); // priority 1 排前面
  });

  it("rejects empty type or id", () => {
    const r = createRegistry();
    expect(() => r.register("", "x", 1)).toThrow();
    expect(() => r.register("tool", "", 1)).toThrow();
  });

  it("U6: unregister removes runtime layer only, static survives", () => {
    const r = createRegistry();
    r.register("command", "c", { label: "static" }, { driverId: "p1", origin: "static" });
    r.register("command", "c", { label: "runtime", handler: () => {} }, { driverId: "p1" });
    r.unregister("command", "c");
    expect(r.get("command", "c")?.value).toEqual({ label: "static" });
    // 无 runtime 时再次 unregister → no-op，static 仍在
    r.unregister("command", "c");
    expect(r.get("command", "c")?.value).toEqual({ label: "static" });
  });

  it("a throwing onChange handler does not block others", () => {
    const r = createRegistry();
    const events: string[] = [];
    r.onChange("tool", () => {
      throw new Error("boom");
    });
    r.onChange("tool", (c) => events.push(c.id));
    expect(() => r.register("tool", "a", 1, { driverId: "p1" })).not.toThrow();
    expect(events).toEqual(["a"]);
  });

  it("queryAll: 空注册表 → []", () => {
    const r = createRegistry();
    expect(r.queryAll()).toEqual([]);
  });

  it("queryAll: runtime 遮蔽 static → 只出现一次且 origin=runtime", () => {
    const r = createRegistry();
    r.register("command", "c", { label: "static" }, { driverId: "p1", origin: "static" });
    r.register("command", "c", { label: "runtime" }, { driverId: "p1" });
    const all = r.queryAll();
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ type: "command", id: "c", driverId: "p1", origin: "runtime" });
    expect(all[0].value).toEqual({ label: "runtime" });
  });

  it("queryAll: static-only 项有效（effective=static，origin=static），与 query 语义一致", () => {
    const r = createRegistry();
    r.register("theme", "t", { css: "x" }, { driverId: "p1", origin: "static" });
    const all = r.queryAll();
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ type: "theme", id: "t", driverId: "p1", origin: "static" });
    expect(all[0].value).toEqual({ css: "x" });
    expect(r.query("theme")).toEqual(all); // queryAll = 各 type query 的并集
  });

  it("queryAll: 两层皆无的条目不出现（unregisterByDriver 全清后）", () => {
    const r = createRegistry();
    r.register("tool", "a", 1, { driverId: "p1", origin: "static" });
    r.register("tool", "b", 2, { driverId: "p2" });
    r.unregisterByDriver("p1"); // 清两层 → a 无 effective
    const all = r.queryAll();
    expect(all.map((c) => c.id)).toEqual(["b"]);
  });

  it("queryAll: 跨多 type 全部枚举", () => {
    const r = createRegistry();
    r.register("tool", "a", 1, { driverId: "p1" });
    r.register("theme", "t1", { css: "x" }, { driverId: "p2" });
    r.register("panel", "p", { title: "P" }, { driverId: "p1" });
    expect(r.queryAll()).toHaveLength(3);
    expect(r.queryAll().map((c) => `${c.type}/${c.id}`).sort()).toEqual(["panel/p", "theme/t1", "tool/a"]);
  });
});
