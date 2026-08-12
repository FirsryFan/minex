import * as fs from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { createInMemoryStorage, createKernel } from "../src/index.js";

/** 在临时目录里造一个插件文件夹 */
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

describe("loadPluginsFromDir", () => {
  it("loads a plugin: registers manifest, static contributions, and entry", async () => {
    const dir = path.join(tmpdir(), `minex-loader-${Date.now()}-${Math.random().toString(36).slice(2)}`);
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
      const ui = kernel.registry.get("ui", "fixture-panel");
      expect(ui?.value).toMatchObject({ location: "leftPanel" });
      // 加载 = 注册，未激活
      expect(kernel.plugins.getState("fixture.demo")).toBe("discovered");

      await kernel.plugins.activate("fixture.demo");
      expect(kernel.plugins.getState("fixture.demo")).toBe("activated");
      // 命令 handler 被 activate 补齐
      const cmd = kernel.registry.get<{ handler: () => string }>("command", "fixture.ping");
      expect(cmd?.value.handler()).toBe("pong");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("reports skipped non-plugin directories", async () => {
    const dir = path.join(tmpdir(), `minex-loader-skip-${Date.now()}`);
    try {
      fs.mkdirSync(path.join(dir, "not-a-plugin"), { recursive: true });
      const kernel = testKernel();
      const result = await kernel.plugins.loadFromDir(dir);
      expect(result.manifests).toHaveLength(0);
      expect(result.skipped).toEqual(["not-a-plugin"]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns empty for missing dir", async () => {
    const kernel = testKernel();
    const result = await kernel.plugins.loadFromDir(path.join(tmpdir(), "does-not-exist-xyz"));
    expect(result.manifests).toHaveLength(0);
  });

  it("throws on invalid manifest", async () => {
    const dir = path.join(tmpdir(), `minex-loader-invalid-${Date.now()}`);
    try {
      makeFixturePlugin(dir, "bad.plugin", { id: "bad id!", name: "Bad", version: "1.0.0" });
      const kernel = testKernel();
      await expect(kernel.plugins.loadFromDir(dir)).rejects.toThrow(/id/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("throws when entry has no activate", async () => {
    const dir = path.join(tmpdir(), `minex-loader-noactivate-${Date.now()}`);
    try {
      const pluginDir = makeFixturePlugin(dir, "noact.demo", {
        id: "noact.demo",
        name: "NoAct",
        version: "1.0.0",
        entry: "./index.mjs",
      });
      makeEntry(pluginDir, `export default { notActivate: true };`);
      const kernel = testKernel();
      await expect(kernel.plugins.loadFromDir(dir)).rejects.toThrow(/activate/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
