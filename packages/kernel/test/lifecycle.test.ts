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
});
