import { describe, expect, it } from "vitest";
import { createInMemoryStorage, createKernel } from "../src/index.js";

function testKernel() {
  return createKernel({ storage: createInMemoryStorage() });
}

describe("kernel lifecycle", () => {
  it("registers, activates, exposes context, and cleans up on deactivate", async () => {
    const kernel = testKernel();
    const seen: string[] = [];
    kernel.drivers.register({
      manifest: { id: "demo", name: "Demo", version: "1.0.0" },
      activate(ctx) {
        seen.push("activate");
        ctx.register("tool", "hello", () => "world");
        expect(ctx.get<() => string>("tool", "hello")()).toBe("world");
        return () => seen.push("cleanup");
      },
    });
    await kernel.drivers.activate("demo");
    expect(kernel.drivers.getState("demo")).toBe("activated");
    expect(seen).toEqual(["activate"]);
    // 宿主视角也能取到能力
    expect(kernel.registry.get<() => string>("tool", "hello")?.value()).toBe("world");

    await kernel.drivers.deactivate("demo");
    expect(kernel.drivers.getState("demo")).toBe("deactivated");
    expect(seen).toEqual(["activate", "cleanup"]);
    // 停用后，该驱动贡献的能力被清理
    expect(kernel.registry.get("tool", "hello")).toBeUndefined();
  });

  it("activates dependencies before dependents", async () => {
    const kernel = testKernel();
    const order: string[] = [];
    kernel.drivers.register({
      manifest: { id: "base", name: "Base", version: "1.0.0" },
      activate() {
        order.push("base");
      },
    });
    kernel.drivers.register({
      manifest: { id: "app", name: "App", version: "1.0.0", dependencies: ["base"] },
      activate() {
        order.push("app");
      },
    });
    await kernel.drivers.activate("app");
    expect(order).toEqual(["base", "app"]);
  });

  it("rejects driver requiring a newer kernel", () => {
    const kernel = testKernel();
    expect(() =>
      kernel.drivers.register({
        manifest: { id: "future", name: "Future", version: "1.0.0", minKernelVersion: "99.0.0" },
        activate: () => {},
      }),
    ).toThrow(/requires kernel >= 99\.0\.0/);
  });

  it("rejects missing dependency", async () => {
    const kernel = testKernel();
    kernel.drivers.register({
      manifest: { id: "orphan", name: "Orphan", version: "1.0.0", dependencies: ["nope"] },
      activate: () => {},
    });
    await expect(kernel.drivers.activate("orphan")).rejects.toThrow(/missing driver "nope"/);
  });

  it("rejects duplicate registration", () => {
    const kernel = testKernel();
    kernel.drivers.register({
      manifest: { id: "dup", name: "Dup", version: "1.0.0" },
      activate: () => {},
    });
    expect(() =>
      kernel.drivers.register({
        manifest: { id: "dup", name: "Dup2", version: "1.0.0" },
        activate: () => {},
      }),
    ).toThrow(/already registered/);
  });

  it("driver storage is namespaced to its own id", async () => {
    const kernel = testKernel();
    kernel.drivers.register({
      manifest: { id: "a", name: "A", version: "1.0.0" },
      activate(ctx) {
        ctx.storage.set("k", "from-a");
        expect(ctx.storage.get("k")).toBe("from-a");
      },
    });
    await kernel.drivers.activate("a");
    expect(kernel.storage.namespace("b").get("k")).toBeUndefined();
    expect(kernel.storage.namespace("a").get("k")).toBe("from-a");
  });

  it("destroy deactivates all activated drivers", async () => {
    const kernel = testKernel();
    const cleaned: string[] = [];
    kernel.drivers.register({
      manifest: { id: "x", name: "X", version: "1.0.0" },
      activate() {
        return () => cleaned.push("x");
      },
    });
    await kernel.drivers.activate("x");
    await kernel.destroy();
    expect(kernel.drivers.getState("x")).toBe("deactivated");
    expect(cleaned).toEqual(["x"]);
  });

  it("activate failure rolls back contributions + subscriptions, state=failed, retry works", async () => {
    const kernel = testKernel();
    let attempts = 0;
    let received = 0;
    kernel.drivers.register({
      manifest: { id: "flaky", name: "Flaky", version: "1.0.0" },
      activate(ctx) {
        attempts++;
        ctx.register("tool", "leak", 42);
        ctx.on("some-topic", () => received++);
        if (attempts === 1) throw new Error("boom");
      },
    });
    // 第一次失败：副作用被回滚
    await expect(kernel.drivers.activate("flaky")).rejects.toThrow("boom");
    expect(kernel.drivers.getState("flaky")).toBe("failed");
    expect(kernel.registry.get("tool", "leak")).toBeUndefined();
    kernel.events.emit("some-topic");
    expect(received).toBe(0); // 订阅已退订
    // 重试成功
    await kernel.drivers.activate("flaky");
    expect(kernel.drivers.getState("flaky")).toBe("activated");
    expect(kernel.registry.get("tool", "leak")?.value).toBe(42);
    kernel.events.emit("some-topic");
    expect(received).toBe(1);
  });

  it("cleanup throwing during deactivate still cleans up and transitions state", async () => {
    const kernel = testKernel();
    kernel.drivers.register({
      manifest: { id: "badclean", name: "BadClean", version: "1.0.0" },
      activate(ctx) {
        ctx.register("tool", "x", 1);
        return () => {
          throw new Error("cleanup boom");
        };
      },
    });
    await kernel.drivers.activate("badclean");
    await expect(kernel.drivers.deactivate("badclean")).rejects.toThrow("cleanup boom");
    expect(kernel.drivers.getState("badclean")).toBe("deactivated"); // finally 仍推进状态
    expect(kernel.registry.get("tool", "x")).toBeUndefined(); // 贡献仍被清理
  });

  it("destroy continues after one driver's deactivate fails", async () => {
    const kernel = testKernel();
    const order: string[] = [];
    kernel.drivers.register({
      manifest: { id: "bad", name: "Bad", version: "1.0.0" },
      activate() {
        return () => {
          throw new Error("bad cleanup");
        };
      },
    });
    kernel.drivers.register({
      manifest: { id: "good", name: "Good", version: "1.0.0" },
      activate() {
        order.push("activate-good");
        return () => order.push("cleanup-good");
      },
    });
    await kernel.drivers.activate("bad");
    await kernel.drivers.activate("good");
    await kernel.destroy();
    expect(order).toEqual(["activate-good", "cleanup-good"]); // good 不被 bad 的失败阻断
    expect(kernel.drivers.getState("good")).toBe("deactivated");
    expect(kernel.drivers.getState("bad")).toBe("deactivated");
  });

  it("concurrent activate dedups (no false circular)", async () => {
    const kernel = testKernel();
    let calls = 0;
    kernel.drivers.register({
      manifest: { id: "c", name: "C", version: "1.0.0" },
      activate() {
        calls++;
      },
    });
    await Promise.all([kernel.drivers.activate("c"), kernel.drivers.activate("c")]);
    expect(calls).toBe(1);
    expect(kernel.drivers.getState("c")).toBe("activated");
  });

  it("detects circular dependencies", async () => {
    const kernel = testKernel();
    kernel.drivers.register({
      manifest: { id: "a", name: "A", version: "1.0.0", dependencies: ["b"] },
      activate: () => {},
    });
    kernel.drivers.register({
      manifest: { id: "b", name: "B", version: "1.0.0", dependencies: ["a"] },
      activate: () => {},
    });
    await expect(kernel.drivers.activate("a")).rejects.toThrow(/Circular dependency/);
    expect(kernel.drivers.getState("a")).toBe("failed");
  });

  it("dependency failure rolls back already-activated deps", async () => {
    const kernel = testKernel();
    kernel.drivers.register({
      manifest: { id: "dep-ok", name: "DepOk", version: "1.0.0" },
      activate: () => {},
    });
    kernel.drivers.register({
      manifest: { id: "dep-bad", name: "DepBad", version: "1.0.0" },
      activate() {
        throw new Error("dep-bad boom");
      },
    });
    kernel.drivers.register({
      manifest: { id: "app", name: "App", version: "1.0.0", dependencies: ["dep-ok", "dep-bad"] },
      activate: () => {},
    });
    await expect(kernel.drivers.activate("app")).rejects.toThrow("dep-bad boom");
    expect(kernel.drivers.getState("app")).toBe("failed");
    expect(kernel.drivers.getState("dep-ok")).toBe("deactivated"); // 已激活依赖被回滚
    expect(kernel.drivers.getState("dep-bad")).toBe("failed");
  });

  it("reload reactivates; reloadable:false is rejected", async () => {
    const kernel = testKernel();
    let activations = 0;
    kernel.drivers.register({
      manifest: { id: "r", name: "R", version: "1.0.0" },
      activate() {
        activations++;
      },
    });
    await kernel.drivers.activate("r");
    await kernel.drivers.reload("r");
    expect(activations).toBe(2);
    expect(kernel.drivers.getState("r")).toBe("activated");

    kernel.drivers.register({
      manifest: { id: "fixed", name: "Fixed", version: "1.0.0", reloadable: false },
      activate: () => {},
    });
    await kernel.drivers.activate("fixed");
    await expect(kernel.drivers.reload("fixed")).rejects.toThrow(/not reloadable/);
  });

  it("deactivated driver cannot activate directly; must reload", async () => {
    const kernel = testKernel();
    kernel.drivers.register({
      manifest: { id: "d", name: "D", version: "1.0.0" },
      activate: () => {},
    });
    await kernel.drivers.activate("d");
    await kernel.drivers.deactivate("d");
    await expect(kernel.drivers.activate("d")).rejects.toThrow(/reload/);
    await kernel.drivers.reload("d");
    expect(kernel.drivers.getState("d")).toBe("activated");
  });

  it("L3: deep dependency failure rolls back the whole chain (no orphan)", async () => {
    const kernel = testKernel();
    kernel.drivers.register({
      manifest: { id: "d", name: "D", version: "1.0.0" },
      activate: () => {},
    });
    kernel.drivers.register({
      manifest: { id: "b", name: "B", version: "1.0.0", dependencies: ["d"] },
      activate: () => {},
    });
    kernel.drivers.register({
      manifest: { id: "a", name: "A", version: "1.0.0", dependencies: ["b"] },
      activate() {
        throw new Error("a boom");
      },
    });
    await expect(kernel.drivers.activate("a")).rejects.toThrow("a boom");
    expect(kernel.drivers.getState("a")).toBe("failed");
    expect(kernel.drivers.getState("b")).toBe("deactivated");
    expect(kernel.drivers.getState("d")).toBe("deactivated"); // 深层依赖不残留
  });
});
