import { describe, expect, it } from "vitest";
import { createInMemoryStorage, createKernel } from "../src/index.js";

function testKernel() {
  return createKernel({ storage: createInMemoryStorage() });
}

describe("kernel lifecycle", () => {
  it("registers, activates, exposes context, and cleans up on deactivate", async () => {
    const kernel = testKernel();
    const seen: string[] = [];
    kernel.plugins.register({
      manifest: { id: "demo", name: "Demo", version: "1.0.0" },
      activate(ctx) {
        seen.push("activate");
        ctx.register("tool", "hello", () => "world");
        expect(ctx.get<() => string>("tool", "hello")()).toBe("world");
        return () => seen.push("cleanup");
      },
    });
    await kernel.plugins.activate("demo");
    expect(kernel.plugins.getState("demo")).toBe("activated");
    expect(seen).toEqual(["activate"]);
    // 宿主视角也能取到能力
    expect(kernel.registry.get<() => string>("tool", "hello")?.value()).toBe("world");

    await kernel.plugins.deactivate("demo");
    expect(kernel.plugins.getState("demo")).toBe("deactivated");
    expect(seen).toEqual(["activate", "cleanup"]);
    // 停用后，该插件贡献的能力被清理
    expect(kernel.registry.get("tool", "hello")).toBeUndefined();
  });

  it("activates dependencies before dependents", async () => {
    const kernel = testKernel();
    const order: string[] = [];
    kernel.plugins.register({
      manifest: { id: "base", name: "Base", version: "1.0.0" },
      activate() {
        order.push("base");
      },
    });
    kernel.plugins.register({
      manifest: { id: "app", name: "App", version: "1.0.0", dependencies: ["base"] },
      activate() {
        order.push("app");
      },
    });
    await kernel.plugins.activate("app");
    expect(order).toEqual(["base", "app"]);
  });

  it("rejects plugin requiring a newer kernel", () => {
    const kernel = testKernel();
    expect(() =>
      kernel.plugins.register({
        manifest: { id: "future", name: "Future", version: "1.0.0", minKernelVersion: "99.0.0" },
        activate: () => {},
      }),
    ).toThrow(/requires kernel >= 99\.0\.0/);
  });

  it("rejects missing dependency", async () => {
    const kernel = testKernel();
    kernel.plugins.register({
      manifest: { id: "orphan", name: "Orphan", version: "1.0.0", dependencies: ["nope"] },
      activate: () => {},
    });
    await expect(kernel.plugins.activate("orphan")).rejects.toThrow(/missing plugin "nope"/);
  });

  it("rejects duplicate registration", () => {
    const kernel = testKernel();
    kernel.plugins.register({
      manifest: { id: "dup", name: "Dup", version: "1.0.0" },
      activate: () => {},
    });
    expect(() =>
      kernel.plugins.register({
        manifest: { id: "dup", name: "Dup2", version: "1.0.0" },
        activate: () => {},
      }),
    ).toThrow(/already registered/);
  });

  it("plugin storage is namespaced to its own id", async () => {
    const kernel = testKernel();
    kernel.plugins.register({
      manifest: { id: "a", name: "A", version: "1.0.0" },
      activate(ctx) {
        ctx.storage.set("k", "from-a");
        expect(ctx.storage.get("k")).toBe("from-a");
      },
    });
    await kernel.plugins.activate("a");
    expect(kernel.storage.namespace("b").get("k")).toBeUndefined();
    expect(kernel.storage.namespace("a").get("k")).toBe("from-a");
  });

  it("destroy deactivates all activated plugins", async () => {
    const kernel = testKernel();
    const cleaned: string[] = [];
    kernel.plugins.register({
      manifest: { id: "x", name: "X", version: "1.0.0" },
      activate() {
        return () => cleaned.push("x");
      },
    });
    await kernel.plugins.activate("x");
    await kernel.destroy();
    expect(kernel.plugins.getState("x")).toBe("deactivated");
    expect(cleaned).toEqual(["x"]);
  });

  it("activate failure rolls back contributions + subscriptions, state=failed, retry works", async () => {
    const kernel = testKernel();
    let attempts = 0;
    let received = 0;
    kernel.plugins.register({
      manifest: { id: "flaky", name: "Flaky", version: "1.0.0" },
      activate(ctx) {
        attempts++;
        ctx.register("tool", "leak", 42);
        ctx.on("some-topic", () => received++);
        if (attempts === 1) throw new Error("boom");
      },
    });
    // 第一次失败：副作用被回滚
    await expect(kernel.plugins.activate("flaky")).rejects.toThrow("boom");
    expect(kernel.plugins.getState("flaky")).toBe("failed");
    expect(kernel.registry.get("tool", "leak")).toBeUndefined();
    kernel.events.emit("some-topic");
    expect(received).toBe(0); // 订阅已退订
    // 重试成功
    await kernel.plugins.activate("flaky");
    expect(kernel.plugins.getState("flaky")).toBe("activated");
    expect(kernel.registry.get("tool", "leak")?.value).toBe(42);
    kernel.events.emit("some-topic");
    expect(received).toBe(1);
  });

  it("cleanup throwing during deactivate still cleans up and transitions state", async () => {
    const kernel = testKernel();
    kernel.plugins.register({
      manifest: { id: "badclean", name: "BadClean", version: "1.0.0" },
      activate(ctx) {
        ctx.register("tool", "x", 1);
        return () => {
          throw new Error("cleanup boom");
        };
      },
    });
    await kernel.plugins.activate("badclean");
    await expect(kernel.plugins.deactivate("badclean")).rejects.toThrow("cleanup boom");
    expect(kernel.plugins.getState("badclean")).toBe("deactivated"); // finally 仍推进状态
    expect(kernel.registry.get("tool", "x")).toBeUndefined(); // 贡献仍被清理
  });

  it("destroy continues after one plugin's deactivate fails", async () => {
    const kernel = testKernel();
    const order: string[] = [];
    kernel.plugins.register({
      manifest: { id: "bad", name: "Bad", version: "1.0.0" },
      activate() {
        return () => {
          throw new Error("bad cleanup");
        };
      },
    });
    kernel.plugins.register({
      manifest: { id: "good", name: "Good", version: "1.0.0" },
      activate() {
        order.push("activate-good");
        return () => order.push("cleanup-good");
      },
    });
    await kernel.plugins.activate("bad");
    await kernel.plugins.activate("good");
    await kernel.destroy();
    expect(order).toEqual(["activate-good", "cleanup-good"]); // good 不被 bad 的失败阻断
    expect(kernel.plugins.getState("good")).toBe("deactivated");
    expect(kernel.plugins.getState("bad")).toBe("deactivated");
  });

  it("concurrent activate dedups (no false circular)", async () => {
    const kernel = testKernel();
    let calls = 0;
    kernel.plugins.register({
      manifest: { id: "c", name: "C", version: "1.0.0" },
      activate() {
        calls++;
      },
    });
    await Promise.all([kernel.plugins.activate("c"), kernel.plugins.activate("c")]);
    expect(calls).toBe(1);
    expect(kernel.plugins.getState("c")).toBe("activated");
  });

  it("detects circular dependencies", async () => {
    const kernel = testKernel();
    kernel.plugins.register({
      manifest: { id: "a", name: "A", version: "1.0.0", dependencies: ["b"] },
      activate: () => {},
    });
    kernel.plugins.register({
      manifest: { id: "b", name: "B", version: "1.0.0", dependencies: ["a"] },
      activate: () => {},
    });
    await expect(kernel.plugins.activate("a")).rejects.toThrow(/Circular dependency/);
    expect(kernel.plugins.getState("a")).toBe("failed");
  });

  it("dependency failure rolls back already-activated deps", async () => {
    const kernel = testKernel();
    kernel.plugins.register({
      manifest: { id: "dep-ok", name: "DepOk", version: "1.0.0" },
      activate: () => {},
    });
    kernel.plugins.register({
      manifest: { id: "dep-bad", name: "DepBad", version: "1.0.0" },
      activate() {
        throw new Error("dep-bad boom");
      },
    });
    kernel.plugins.register({
      manifest: { id: "app", name: "App", version: "1.0.0", dependencies: ["dep-ok", "dep-bad"] },
      activate: () => {},
    });
    await expect(kernel.plugins.activate("app")).rejects.toThrow("dep-bad boom");
    expect(kernel.plugins.getState("app")).toBe("failed");
    expect(kernel.plugins.getState("dep-ok")).toBe("deactivated"); // 已激活依赖被回滚
    expect(kernel.plugins.getState("dep-bad")).toBe("failed");
  });

  it("reload reactivates; reloadable:false is rejected", async () => {
    const kernel = testKernel();
    let activations = 0;
    kernel.plugins.register({
      manifest: { id: "r", name: "R", version: "1.0.0" },
      activate() {
        activations++;
      },
    });
    await kernel.plugins.activate("r");
    await kernel.plugins.reload("r");
    expect(activations).toBe(2);
    expect(kernel.plugins.getState("r")).toBe("activated");

    kernel.plugins.register({
      manifest: { id: "fixed", name: "Fixed", version: "1.0.0", reloadable: false },
      activate: () => {},
    });
    await kernel.plugins.activate("fixed");
    await expect(kernel.plugins.reload("fixed")).rejects.toThrow(/not reloadable/);
  });

  it("deactivated plugin cannot activate directly; must reload", async () => {
    const kernel = testKernel();
    kernel.plugins.register({
      manifest: { id: "d", name: "D", version: "1.0.0" },
      activate: () => {},
    });
    await kernel.plugins.activate("d");
    await kernel.plugins.deactivate("d");
    await expect(kernel.plugins.activate("d")).rejects.toThrow(/reload/);
    await kernel.plugins.reload("d");
    expect(kernel.plugins.getState("d")).toBe("activated");
  });
});
