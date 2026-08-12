import { describe, expect, it } from "vitest";
import { createRegistry } from "../src/index.js";

describe("capability registry", () => {
  it("registers and queries", () => {
    const r = createRegistry();
    r.register("tool", "a", 1, { pluginId: "p1" });
    r.register("tool", "b", 2, { pluginId: "p2" });
    expect(r.query("tool")).toHaveLength(2);
    expect(r.get("tool", "a")?.value).toBe(1);
    expect(r.query("tool")[0].pluginId).toBe("p1"); // priority 相等时先注册者先（稳定排序）
  });

  it("filters by plugin", () => {
    const r = createRegistry();
    r.register("tool", "a", 1, { pluginId: "p1" });
    r.register("tool", "b", 2, { pluginId: "p2" });
    const fromP1 = r.query("tool", { plugin: "p1" });
    expect(fromP1).toHaveLength(1);
    expect(fromP1[0].id).toBe("a");
  });

  it("priority wins on conflict", () => {
    const r = createRegistry();
    r.register("tool", "x", "low", { pluginId: "p1", priority: 0 });
    r.register("tool", "x", "high", { pluginId: "p2", priority: 10 });
    expect(r.get("tool", "x")?.value).toBe("high");
    // 低优先级尝试覆盖高优先级 → 拒绝
    r.register("tool", "x", "should-fail", { pluginId: "p3", priority: 5 });
    expect(r.get("tool", "x")?.value).toBe("high");
    // 同 id 查询时高优先级排前面
    expect(r.query("tool")[0].value).toBe("high");
  });

  it("unregisters and notifies onChange", () => {
    const r = createRegistry();
    const events: string[] = [];
    const off = r.onChange("tool", (c) => events.push(`${c.action}:${c.id}`));
    r.register("tool", "a", 1, { pluginId: "p1" });
    r.unregister("tool", "a");
    off();
    r.register("tool", "b", 2, { pluginId: "p1" });
    expect(events).toEqual(["registered:a", "unregistered:a"]);
  });

  it("unregisterByPlugin removes everything from a plugin", () => {
    const r = createRegistry();
    r.register("tool", "a", 1, { pluginId: "p1" });
    r.register("tool", "b", 2, { pluginId: "p1" });
    r.register("tool", "c", 3, { pluginId: "p2" });
    r.unregisterByPlugin("p1");
    expect(r.query("tool")).toHaveLength(1);
    expect(r.get("tool", "c")?.value).toBe(3);
  });
});
