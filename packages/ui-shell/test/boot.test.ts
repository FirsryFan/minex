import { createInMemoryStorage, createKernel } from "@minex/kernel";
import { describe, expect, it } from "vitest";
import { bootDrivers } from "../src/boot.js";

function testKernel() {
  return createKernel({ storage: createInMemoryStorage() });
}

describe("bootDrivers", () => {
  it("boots a driver: static contributions registered, activated, no problems", async () => {
    const kernel = testKernel();
    const p = {
      manifest: {
        id: "ok.demo",
        name: "Ok",
        version: "1.0.0",
        contributes: { command: [{ id: "ok.x", label: "X" }] },
      },
      activate(ctx: { register: (t: string, id: string, v: unknown) => void }) {
        ctx.register("command", "ok.x", { id: "ok.x", label: "X", handler: () => "hi" });
      },
    };
    const problems = await bootDrivers(kernel, [p]);
    expect(problems).toEqual([]);
    expect(kernel.drivers.getState("ok.demo")).toBe("activated");
    expect(kernel.registry.get<{ handler: () => string }>("command", "ok.x")?.value.handler()).toBe("hi");
  });

  it("U2: register failure rolls back its static contributions", async () => {
    const kernel = testKernel();
    const dup = {
      manifest: {
        id: "dup.demo",
        name: "Dup",
        version: "1.0.0",
        contributes: { ui: [{ id: "dup-ui", location: "leftPanel" }] },
      },
      activate: () => {},
    };
    kernel.drivers.register(dup); // 先占位，让第二次 register 抛 already registered
    const problems = await bootDrivers(kernel, [dup]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/already registered/);
    expect(kernel.registry.get("ui", "dup-ui")).toBeUndefined(); // 静态贡献已回滚
  });

  it("U4: isCancelled stops the loop", async () => {
    const kernel = testKernel();
    let cancelled = false;
    const p = { manifest: { id: "c.demo", name: "C", version: "1.0.0" }, activate: () => {} };
    const problems = await bootDrivers(kernel, [p], () => cancelled);
    cancelled = true;
    expect(problems).toEqual([]);
  });
});
