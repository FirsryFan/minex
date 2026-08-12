import { describe, expect, it, vi } from "vitest";
import { createInMemoryStorage, createKernel } from "@minex/kernel";
import { configCmd, pluginsCmd, runCommand } from "../src/main.js";

function testKernel() {
  return createKernel({ storage: createInMemoryStorage() });
}

function silence() {
  const logs: unknown[][] = [];
  const log = vi.spyOn(console, "log").mockImplementation((...a) => logs.push(a));
  const err = vi.spyOn(console, "error").mockImplementation((...a) => logs.push(a));
  return { logs, restore: () => (log.mockRestore(), err.mockRestore()) };
}

describe("cli commands", () => {
  it("run executes a command handler with args", async () => {
    const kernel = testKernel();
    kernel.plugins.register({
      manifest: { id: "t.demo", name: "T", version: "1.0.0" },
      activate(ctx) {
        ctx.register<{ id: string; handler: (name: string) => string }>("command", "t.greet", {
          id: "t.greet",
          handler: (name: string) => `hi ${name}`,
        });
      },
    });
    await kernel.plugins.activate("t.demo");

    const { logs, restore } = silence();
    const code = await runCommand(kernel, ["t.greet", "minex"]);
    expect(code).toBe(0);
    expect(logs).toEqual([["hi minex"]]);
    restore();
  });

  it("run reports missing command", async () => {
    const kernel = testKernel();
    const { logs, restore } = silence();
    const code = await runCommand(kernel, ["nope"]);
    expect(code).toBe(1);
    expect(logs[0][0]).toMatch(/command not found/);
    restore();
  });

  it("run reports handler-less command (declared but no handler)", async () => {
    const kernel = testKernel();
    kernel.plugins.register({
      manifest: { id: "s.demo", name: "S", version: "1.0.0" },
      activate(ctx) {
        ctx.register<{ id: string; label: string }>("command", "s.x", { id: "s.x", label: "X" }); // 只有 label，无 handler
      },
    });
    await kernel.plugins.activate("s.demo");
    const { logs, restore } = silence();
    const code = await runCommand(kernel, ["s.x"]);
    expect(code).toBe(1);
    expect(logs[0][0]).toMatch(/no handler/);
    restore();
  });

  it("config set / get round-trip", async () => {
    const kernel = testKernel();
    const { logs, restore } = silence();
    await configCmd(kernel, ["set", "minex.demo", "config", '{"greeting":"Hi"}']);
    expect(kernel.storage.namespace("minex.demo").get("config")).toEqual({ greeting: "Hi" });

    await configCmd(kernel, ["get", "minex.demo", "config"]);
    expect(logs).toContainEqual([JSON.stringify({ greeting: "Hi" }, null, 2)]);
    restore();
  });

  it("config get reports unset", async () => {
    const kernel = testKernel();
    const { logs, restore } = silence();
    await configCmd(kernel, ["get", "minex.demo", "missing"]);
    expect(logs).toEqual([["(unset)"]]);
    restore();
  });

  it("plugins list shows id, version, state", async () => {
    const kernel = testKernel();
    kernel.plugins.register({ manifest: { id: "p.demo", name: "P", version: "1.0.0" }, activate: () => {} });
    await kernel.plugins.activate("p.demo");
    const { logs, restore } = silence();
    await pluginsCmd(kernel, ["list"]);
    expect(logs).toContainEqual(["p.demo\t1.0.0\tactivated"]);
    restore();
  });
});
