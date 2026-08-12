import * as fs from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { createInMemoryStorage, createKernel } from "../src/index.js";

function makeFixtureDriver(dir: string, id: string, manifest: Record<string, unknown>): string {
  const driverDir = path.join(dir, id);
  fs.mkdirSync(driverDir, { recursive: true });
  fs.writeFileSync(path.join(driverDir, "manifest.json"), JSON.stringify(manifest, null, 2));
  return driverDir;
}

function makeEntry(driverDir: string, code: string): void {
  fs.writeFileSync(path.join(driverDir, "index.mjs"), code);
}

function testKernel() {
  return createKernel({ storage: createInMemoryStorage() });
}

function tempDir(tag: string): string {
  return path.join(tmpdir(), `minex-loader-${tag}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
}

describe("loadDriversFromDir", () => {
  it("loads a driver: registers manifest, static contributions, and entry", async () => {
    const dir = tempDir("ok");
    try {
      const driverDir = makeFixtureDriver(dir, "fixture.demo", {
        id: "fixture.demo",
        name: "Fixture",
        version: "1.0.0",
        entry: "./index.mjs",
        contributes: {
          ui: [{ id: "fixture-panel", location: "leftPanel", title: "Fixture" }],
          command: [{ id: "fixture.ping", label: "Ping" }],
        },
      });
      makeEntry(
        driverDir,
        `export default {
          activate(ctx) {
            ctx.register("command", "fixture.ping", {
              id: "fixture.ping",
              handler: () => "pong",
            });
            return () => {};
          },
        };`,
      );

      const kernel = testKernel();
      const result = await kernel.drivers.loadFromDir(dir);

      expect(result.manifests).toHaveLength(1);
      expect(result.manifests[0].id).toBe("fixture.demo");
      // 静态贡献在激活前已注册
      expect(kernel.registry.get("ui", "fixture-panel")?.value).toMatchObject({ location: "leftPanel" });
      expect(kernel.drivers.getState("fixture.demo")).toBe("discovered");

      await kernel.drivers.activate("fixture.demo");
      expect(kernel.drivers.getState("fixture.demo")).toBe("activated");
      const cmd = kernel.registry.get<{ handler: () => string }>("command", "fixture.ping");
      expect(cmd?.value.handler()).toBe("pong");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("per-driver fault tolerance: invalid manifest is reported as failed, others still load", async () => {
    const dir = tempDir("mixed");
    try {
      makeFixtureDriver(dir, "bad.driver", { id: "bad id!", name: "Bad", version: "1.0.0" });
      const goodDir = makeFixtureDriver(dir, "good.demo", {
        id: "good.demo",
        name: "Good",
        version: "1.0.0",
        entry: "./index.mjs",
      });
      makeEntry(goodDir, `export default { activate: () => {} };`);

      const kernel = testKernel();
      const result = await kernel.drivers.loadFromDir(dir);

      expect(result.failed).toHaveLength(1);
      expect(result.failed[0].id).toBe("bad.driver");
      expect(result.manifests.map((m) => m.id)).toEqual(["good.demo"]); // good 不受影响
      expect(kernel.drivers.getState("good.demo")).toBe("discovered");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("L1: entry without activate is reported as failed AND its static contributions are rolled back", async () => {
    const dir = tempDir("leak");
    try {
      const driverDir = makeFixtureDriver(dir, "leak.demo", {
        id: "leak.demo",
        name: "Leak",
        version: "1.0.0",
        entry: "./index.mjs",
        contributes: { ui: [{ id: "leak-ui", location: "leftPanel" }] },
      });
      makeEntry(driverDir, `export default { notActivate: true };`);

      const kernel = testKernel();
      const result = await kernel.drivers.loadFromDir(dir);

      expect(result.failed).toHaveLength(1);
      expect(result.failed[0].id).toBe("leak.demo");
      // 静态贡献已回滚，无残留
      expect(kernel.registry.get("ui", "leak-ui")).toBeUndefined();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("L4: second loadFromDir reports alreadyRegistered, does not throw", async () => {
    const dir = tempDir("dup");
    try {
      const driverDir = makeFixtureDriver(dir, "dup.demo", {
        id: "dup.demo",
        name: "Dup",
        version: "1.0.0",
        entry: "./index.mjs",
      });
      makeEntry(driverDir, `export default { activate: () => {} };`);

      const kernel = testKernel();
      const first = await kernel.drivers.loadFromDir(dir);
      expect(first.manifests).toHaveLength(1);

      const second = await kernel.drivers.loadFromDir(dir);
      expect(second.alreadyRegistered).toEqual(["dup.demo"]);
      expect(second.manifests).toHaveLength(0);
      expect(second.failed).toHaveLength(0);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("L2: pure static contributions survive reload", async () => {
    const dir = tempDir("static-live");
    try {
      const driverDir = makeFixtureDriver(dir, "stat.demo", {
        id: "stat.demo",
        name: "Stat",
        version: "1.0.0",
        entry: "./index.mjs",
        contributes: { ui: [{ id: "stat-ui", location: "leftPanel" }] },
      });
      makeEntry(driverDir, `export default { activate: (ctx) => { ctx.register("tool", "stat.t", 1); } };`);

      const kernel = testKernel();
      await kernel.drivers.loadFromDir(dir);
      await kernel.drivers.activate("stat.demo");
      expect(kernel.registry.get("ui", "stat-ui")).toBeDefined(); // 静态可见

      await kernel.drivers.reload("stat.demo");
      // 纯静态贡献不随 reload 丢失
      expect(kernel.registry.get("ui", "stat-ui")).toBeDefined();
      // 运行时贡献被重新注册
      expect(kernel.registry.get("tool", "stat.t")?.value).toBe(1);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("m8: malformed manifest.json JSON is reported as failed", async () => {
    const dir = tempDir("json-syntax");
    try {
      const driverDir = path.join(dir, "badjson.demo");
      fs.mkdirSync(driverDir, { recursive: true });
      fs.writeFileSync(path.join(driverDir, "manifest.json"), "{ not valid json");

      const kernel = testKernel();
      const result = await kernel.drivers.loadFromDir(dir);
      expect(result.failed).toHaveLength(1);
      expect(result.failed[0].id).toBe("badjson.demo");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("C2: static label survives deactivate after runtime upgrade (layered shadow)", async () => {
    const dir = tempDir("upgrade");
    try {
      const driverDir = makeFixtureDriver(dir, "up.demo", {
        id: "up.demo",
        name: "Up",
        version: "1.0.0",
        entry: "./index.mjs",
        contributes: { command: [{ id: "up.hello", label: "Hello" }] },
      });
      makeEntry(
        driverDir,
        `export default {
          activate(ctx) {
            ctx.register("command", "up.hello", { id: "up.hello", label: "Hello", handler: () => "hi" });
          },
        };`,
      );

      const kernel = testKernel();
      await kernel.drivers.loadFromDir(dir);
      // 激活前：静态 label 可见，无 handler
      const before = kernel.registry.get<{ handler?: unknown; label: string }>("command", "up.hello");
      expect(before?.value.label).toBe("Hello");
      expect(before?.value.handler).toBeUndefined();

      await kernel.drivers.activate("up.demo");
      // 激活时：有效值 = runtime（带 handler）
      expect(kernel.registry.get<{ handler: () => string }>("command", "up.hello")?.value.handler()).toBe("hi");

      await kernel.drivers.deactivate("up.demo");
      // 停用后：runtime 被揭掉，静态 label 露出，handler 消失
      const after = kernel.registry.get<{ handler?: unknown; label: string }>("command", "up.hello");
      expect(after).toBeDefined();
      expect(after?.value.label).toBe("Hello");
      expect(after?.value.handler).toBeUndefined();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("reports skipped non-driver directories", async () => {
    const dir = tempDir("skip");
    try {
      fs.mkdirSync(path.join(dir, "not-a-driver"), { recursive: true });
      const kernel = testKernel();
      const result = await kernel.drivers.loadFromDir(dir);
      expect(result.skipped).toEqual(["not-a-driver"]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns empty for missing dir", async () => {
    const kernel = testKernel();
    const result = await kernel.drivers.loadFromDir(path.join(tmpdir(), "does-not-exist-xyz"));
    expect(result.manifests).toHaveLength(0);
    expect(result.failed).toHaveLength(0);
  });
});
