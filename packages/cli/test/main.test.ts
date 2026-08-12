import * as fs from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createInMemoryStorage, createKernel } from "@minex/kernel";
import { configCmd, main, pluginsCmd, runCommand } from "../src/main.js";

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

  it("C1: main survives one plugin activation failure, read-only command still works", async () => {
    const dir = path.join(tmpdir(), `minex-main-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const dataDir = path.join(tmpdir(), `minex-main-data-${Date.now()}`);
    try {
      // bad：activate 抛错
      const badDir = path.join(dir, "bad.demo");
      fs.mkdirSync(badDir, { recursive: true });
      fs.writeFileSync(
        path.join(badDir, "manifest.json"),
        JSON.stringify({ id: "bad.demo", name: "Bad", version: "1.0.0", entry: "./index.mjs" }),
      );
      fs.writeFileSync(badDir + "/index.mjs", `export default { activate: () => { throw new Error("boom"); } };`);
      // good：正常激活
      const goodDir = path.join(dir, "good.demo");
      fs.mkdirSync(goodDir, { recursive: true });
      fs.writeFileSync(
        path.join(goodDir, "manifest.json"),
        JSON.stringify({ id: "good.demo", name: "Good", version: "1.0.0", entry: "./index.mjs" }),
      );
      fs.writeFileSync(goodDir + "/index.mjs", `export default { activate: () => {} };`);

      const { logs, restore } = silence();
      const code = await main(["plugins", "list"], { pluginsDir: dir, storageDir: dataDir });
      expect(code).toBe(0);
      expect(logs).toContainEqual(["good.demo\t1.0.0\tactivated"]);
      const joined = logs.map((l) => String(l[0])).join("\n");
      expect(joined).toMatch(/\[plugin unavailable\] bad\.demo: boom/);
      expect(joined).not.toMatch(/ at /); // 无 stack trace
      restore();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it("C3: main catches dispatch errors with friendly message", async () => {
    const dir = path.join(tmpdir(), `minex-plugins-empty-${Date.now()}`);
    const dataDir = path.join(tmpdir(), `minex-main-c3-${Date.now()}`);
    try {
      fs.mkdirSync(dir, { recursive: true }); // 空目录
      const { logs, restore } = silence();
      const code = await main(["plugins", "activate", "ghost"], { pluginsDir: dir, storageDir: dataDir });
      expect(code).toBe(1);
      const joined = logs.map((l) => String(l[0])).join("\n");
      expect(joined).toMatch(/错误: Unknown plugin: ghost/);
      expect(joined).not.toMatch(/ at /); // 无 stack trace
      restore();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });
});
