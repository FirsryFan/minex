import * as fs from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { createInMemoryStorage, createKernel } from "../src/index.js";

function makeFixturePlugin(dir: string, id: string, manifest: Record<string, unknown>): string {
  const pluginDir = path.join(dir, id);
  fs.mkdirSync(pluginDir, { recursive: true });
  fs.writeFileSync(path.join(pluginDir, "manifest.json"), JSON.stringify(manifest, null, 2));
  return pluginDir;
}

function makeEntry(pluginDir: string, code: string): void {
  fs.writeFileSync(path.join(pluginDir, "index.mjs"), code);
}

function testKernel() {
  return createKernel({ storage: createInMemoryStorage() });
}

function tempDir(tag: string): string {
  return path.join(tmpdir(), `minex-loader-${tag}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
}

describe("loadPluginsFromDir", () => {
  it("loads a plugin: registers manifest, static contributions, and entry", async () => {
    const dir = tempDir("ok");
    try {
      const pluginDir = makeFixturePlugin(dir, "fixture.demo", {
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
        pluginDir,
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
      const result = await kernel.plugins.loadFromDir(dir);

      expect(result.manifests).toHaveLength(1);
      expect(result.manifests[0].id).toBe("fixture.demo");
      // 静态贡献在激活前已注册
      expect(kernel.registry.get("ui", "fixture-panel")?.value).toMatchObject({ location: "leftPanel" });
      expect(kernel.plugins.getState("fixture.demo")).toBe("discovered");

      await kernel.plugins.activate("fixture.demo");
      expect(kernel.plugins.getState("fixture.demo")).toBe("activated");
      const cmd = kernel.registry.get<{ handler: () => string }>("command", "fixture.ping");
      expect(cmd?.value.handler()).toBe("pong");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("per-plugin fault tolerance: invalid manifest is reported as failed, others still load", async () => {
    const dir = tempDir("mixed");
    try {
      makeFixturePlugin(dir, "bad.plugin", { id: "bad id!", name: "Bad", version: "1.0.0" });
      const goodDir = makeFixturePlugin(dir, "good.demo", {
        id: "good.demo",
        name: "Good",
        version: "1.0.0",
        entry: "./index.mjs",
      });
      makeEntry(goodDir, `export default { activate: () => {} };`);

      const kernel = testKernel();
      const result = await kernel.plugins.loadFromDir(dir);

      expect(result.failed).toHaveLength(1);
      expect(result.failed[0].id).toBe("bad.plugin");
      expect(result.manifests.map((m) => m.id)).toEqual(["good.demo"]); // good 不受影响
      expect(kernel.plugins.getState("good.demo")).toBe("discovered");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("L1: entry without activate is reported as failed AND its static contributions are rolled back", async () => {
    const dir = tempDir("leak");
    try {
      const pluginDir = makeFixturePlugin(dir, "leak.demo", {
        id: "leak.demo",
        name: "Leak",
        version: "1.0.0",
        entry: "./index.mjs",
        contributes: { ui: [{ id: "leak-ui", location: "leftPanel" }] },
      });
      makeEntry(pluginDir, `export default { notActivate: true };`);

      const kernel = testKernel();
      const result = await kernel.plugins.loadFromDir(dir);

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
      const pluginDir = makeFixturePlugin(dir, "dup.demo", {
        id: "dup.demo",
        name: "Dup",
        version: "1.0.0",
        entry: "./index.mjs",
      });
      makeEntry(pluginDir, `export default { activate: () => {} };`);

      const kernel = testKernel();
      const first = await kernel.plugins.loadFromDir(dir);
      expect(first.manifests).toHaveLength(1);

      const second = await kernel.plugins.loadFromDir(dir);
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
      const pluginDir = makeFixturePlugin(dir, "stat.demo", {
        id: "stat.demo",
        name: "Stat",
        version: "1.0.0",
        entry: "./index.mjs",
        contributes: { ui: [{ id: "stat-ui", location: "leftPanel" }] },
      });
      makeEntry(pluginDir, `export default { activate: (ctx) => { ctx.register("tool", "stat.t", 1); } };`);

      const kernel = testKernel();
      await kernel.plugins.loadFromDir(dir);
      await kernel.plugins.activate("stat.demo");
      expect(kernel.registry.get("ui", "stat-ui")).toBeDefined(); // 静态可见

      await kernel.plugins.reload("stat.demo");
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
      const pluginDir = path.join(dir, "badjson.demo");
      fs.mkdirSync(pluginDir, { recursive: true });
      fs.writeFileSync(path.join(pluginDir, "manifest.json"), "{ not valid json");

      const kernel = testKernel();
      const result = await kernel.plugins.loadFromDir(dir);
      expect(result.failed).toHaveLength(1);
      expect(result.failed[0].id).toBe("badjson.demo");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("reports skipped non-plugin directories", async () => {
    const dir = tempDir("skip");
    try {
      fs.mkdirSync(path.join(dir, "not-a-plugin"), { recursive: true });
      const kernel = testKernel();
      const result = await kernel.plugins.loadFromDir(dir);
      expect(result.skipped).toEqual(["not-a-plugin"]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns empty for missing dir", async () => {
    const kernel = testKernel();
    const result = await kernel.plugins.loadFromDir(path.join(tmpdir(), "does-not-exist-xyz"));
    expect(result.manifests).toHaveLength(0);
    expect(result.failed).toHaveLength(0);
  });
});
