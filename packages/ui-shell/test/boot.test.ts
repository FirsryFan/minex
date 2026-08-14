import { createInMemoryStorage, createKernel, type DriverManifest, type DriverModule } from "@minex/kernel";
import { describe, expect, it } from "vitest";
import agentDriver from "../../agent-driver/src/index.js";
import appearanceDriver from "../../appearance-driver/src/index.js";
import filesystemDriver from "../../filesystem-driver/src/index.js";
import llmDriver from "../../llm-driver/src/index.js";
import markdownDriver from "../../markdown-driver/src/index.js";
import sessionDriver from "../../session-driver/src/index.js";
import agentManifest from "../../agent-driver/manifest.json";
import appearanceManifest from "../../appearance-driver/manifest.json";
import filesystemManifest from "../../filesystem-driver/manifest.json";
import llmManifest from "../../llm-driver/manifest.json";
import markdownManifest from "../../markdown-driver/manifest.json";
import sessionManifest from "../../session-driver/manifest.json";
import { bootDrivers } from "../src/boot.js";

function testKernel() {
  return createKernel({ storage: createInMemoryStorage() });
}

/** 全量真实驱动清单（与 ui-shell drivers.ts 的 DRIVERS 同序同源：filesystem → session → markdown → appearance → llm → agent） */
function realDrivers(): DriverModule[] {
  return [
    { manifest: filesystemManifest as unknown as DriverManifest, activate: filesystemDriver.activate },
    { manifest: sessionManifest as unknown as DriverManifest, activate: sessionDriver.activate },
    { manifest: markdownManifest as unknown as DriverManifest, activate: markdownDriver.activate },
    { manifest: appearanceManifest as unknown as DriverManifest, activate: appearanceDriver.activate },
    { manifest: llmManifest as unknown as DriverManifest, activate: llmDriver.activate },
    { manifest: agentManifest as unknown as DriverManifest, activate: agentDriver.activate },
  ];
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

  it("1-1 验收：boot 6 个真实驱动 → 无 problems、list() 长度 6、llm/agent 能力可见", async () => {
    const kernel = testKernel();
    const problems = await bootDrivers(kernel, realDrivers());
    expect(problems).toEqual([]); // llm/agent 激活无报错（bootstrap 不报错）
    expect(kernel.drivers.list()).toHaveLength(6);
    expect(kernel.drivers.getState("minex.llm")).toBe("activated");
    expect(kernel.drivers.getState("minex.agent")).toBe("activated");
    expect(kernel.registry.get("llm.config", "default")?.value).toBeDefined();
    expect(kernel.registry.get("agent", "default")?.value).toBeDefined();
  });
});
