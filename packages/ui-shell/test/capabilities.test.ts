import {
  createInMemoryStorage,
  createKernel,
  type DriverManifest,
  type DriverModule,
  type MinexKernel,
} from "@minex/kernel";
import { describe, expect, it } from "vitest";
import appearanceDriver from "../../appearance-driver/src/index.js";
import filesystemDriver from "../../filesystem-driver/src/index.js";
import markdownDriver from "../../markdown-driver/src/index.js";
import sessionDriver from "../../session-driver/src/index.js";
import appearanceManifest from "../../appearance-driver/manifest.json";
import filesystemManifest from "../../filesystem-driver/manifest.json";
import markdownManifest from "../../markdown-driver/manifest.json";
import sessionManifest from "../../session-driver/manifest.json";
import { bootDrivers } from "../src/boot.js";
import {
  collectCapabilities,
  KNOWN_CAPABILITY_TYPES,
  type CapabilityContribution,
  type CapabilityOrigin,
} from "../src/capabilities.js";

/**
 * 真实驱动清单（与 ui-shell drivers.ts 的 DRIVERS 同序同源，仅略去图标 URL——
 * 能力聚合只看 registry 贡献，与图标资产无关）。
 */
function realDrivers(): DriverModule[] {
  return [
    { manifest: filesystemManifest as unknown as DriverManifest, activate: filesystemDriver.activate },
    { manifest: sessionManifest as unknown as DriverManifest, activate: sessionDriver.activate },
    { manifest: markdownManifest as unknown as DriverManifest, activate: markdownDriver.activate },
    { manifest: appearanceManifest as unknown as DriverManifest, activate: appearanceDriver.activate },
  ];
}

/** 构造测试内核：注册驱动（不激活）+ 以显式 driverId/origin 直写 registry 贡献（模拟宿主/驱动注册）。 */
function makeKernel(
  driverIds: string[],
  contributions: Array<{ type: string; id: string; driverId: string; origin?: CapabilityOrigin }>,
): MinexKernel {
  const kernel = createKernel({ storage: createInMemoryStorage() });
  for (const id of driverIds) {
    kernel.drivers.register({ manifest: { id, name: id, version: "1.0.0" }, activate: () => {} });
  }
  for (const c of contributions) {
    kernel.registry.register(c.type, c.id, { marker: c.id }, { driverId: c.driverId, origin: c.origin });
  }
  return kernel;
}

describe("collectCapabilities", () => {
  it("真实驱动集成：filesystem/markdown/appearance 贡献清单与 registry.query(type,{driver}) 实际一致", async () => {
    const kernel = createKernel({ storage: createInMemoryStorage() });
    const problems = await bootDrivers(kernel, realDrivers()); // 走真实入口：boot → register → activate
    expect(problems).toEqual([]);

    const caps = collectCapabilities(kernel);
    expect(caps.map((d) => d.driverId)).toEqual([
      "minex.filesystem",
      "mist.session",
      "minex.markdown",
      "minex.appearance",
    ]);

    // 交叉核对：输出 === 逐 (driver, type) 的 registry.query 聚合（验收 2 的一致性命题）
    for (const d of caps) {
      const expected: CapabilityContribution[] = [];
      for (const type of KNOWN_CAPABILITY_TYPES) {
        for (const c of kernel.registry.query<unknown>(type, { driver: d.driverId })) {
          expected.push({ type: c.type, id: c.id, origin: c.origin });
        }
      }
      expect(d.contributions).toEqual(expected);
    }

    // 每个驱动贡献的 type 集合（与各驱动 index.ts 实际注册一致）
    const typesOf = (id: string): string[] =>
      caps.find((d) => d.driverId === id)!.contributions.map((c) => c.type).sort();
    // filesystem：filesystem/default + 两个 panel（sidebar + workspace）
    expect(typesOf("minex.filesystem")).toEqual(["filesystem", "panel", "panel"]);
    expect(
      caps
        .find((d) => d.driverId === "minex.filesystem")!
        .contributions.map((c) => c.id)
        .sort(),
    ).toEqual(["default", "minex.filesystem.sidebar", "minex.filesystem.workspace"]);
    expect(typesOf("minex.markdown")).toEqual([
      "appearance.driverSetting",
      "markdown",
      "panel",
      "settingsView",
      "theme",
    ]);
    // appearance：3 个 theme（light/dark/global）+ 1 个 settingsView
    expect(typesOf("minex.appearance")).toEqual(["settingsView", "theme", "theme", "theme"]);

    // id + origin 抽查（appearance：3 个 theme + 1 个 settingsView）
    const appearance = caps.find((d) => d.driverId === "minex.appearance")!;
    expect(appearance.contributions.map((c) => c.id).sort()).toEqual([
      "minex.appearance",
      "minex.appearance.dark",
      "minex.appearance.global",
      "minex.appearance.light",
    ]);
    // 真实驱动全部 runtime 贡献（manifest 无 contributes 静态声明）
    expect(appearance.contributions.every((c) => c.origin === "runtime")).toBe(true);

    // 目录边界：session 的 session / session.md（KNOWN_CAPABILITY_TYPES 之外）不被采集，只采其 panel
    const session = caps.find((d) => d.driverId === "mist.session")!;
    expect(session.contributions.map((c) => c.type)).not.toContain("session");
    expect(session.contributions.map((c) => c.type)).not.toContain("session.md");
    expect(session.contributions.map((c) => c.type).sort()).toEqual(["panel"]);
  });

  it("多驱动多 type 正常聚合", () => {
    const kernel = makeKernel(["alpha.demo", "beta.demo"], [
      { type: "theme", id: "t1", driverId: "alpha.demo" },
      { type: "panel", id: "p1", driverId: "alpha.demo" },
      { type: "panel", id: "p2", driverId: "beta.demo" },
      { type: "settingsView", id: "sv", driverId: "beta.demo" },
    ]);
    const caps = collectCapabilities(kernel);
    expect(caps).toHaveLength(2);
    expect(caps[0].driverId).toBe("alpha.demo");
    expect(caps[0].contributions.map((c) => `${c.type}:${c.id}`).sort()).toEqual(["panel:p1", "theme:t1"]);
    expect(caps[1].driverId).toBe("beta.demo");
    expect(caps[1].contributions.map((c) => `${c.type}:${c.id}`).sort()).toEqual(["panel:p2", "settingsView:sv"]);
  });

  it("已加载但无贡献的驱动 → 空数组", () => {
    const kernel = makeKernel(["ghost.demo"], []);
    expect(collectCapabilities(kernel)).toEqual([{ driverId: "ghost.demo", contributions: [] }]);
  });

  it("static+runtime 混合：origin 区分；同 (type,id) runtime 遮蔽 static", () => {
    const kernel = makeKernel(["alpha.demo"], [
      { type: "theme", id: "t-static", driverId: "alpha.demo", origin: "static" },
      { type: "panel", id: "p-runtime", driverId: "alpha.demo", origin: "runtime" },
      { type: "theme", id: "t-shadow", driverId: "alpha.demo", origin: "static" },
      { type: "theme", id: "t-shadow", driverId: "alpha.demo", origin: "runtime" },
    ]);
    const [d] = collectCapabilities(kernel);
    const originOf = new Map(d.contributions.map((c) => [c.id, c.origin]));
    expect(originOf.get("t-static")).toBe("static");
    expect(originOf.get("p-runtime")).toBe("runtime");
    expect(originOf.get("t-shadow")).toBe("runtime"); // 有效值 = runtime ?? static
    expect(originOf.size).toBe(3); // 同 (type,id) 只一条（无重复）
  });

  it("自定义 type 目录：只采集传入的 type", () => {
    const kernel = makeKernel(["alpha.demo"], [
      { type: "theme", id: "t1", driverId: "alpha.demo" },
      { type: "panel", id: "p1", driverId: "alpha.demo" },
    ]);
    const [d] = collectCapabilities(kernel, ["theme"]);
    expect(d.contributions.map((c) => c.id)).toEqual(["t1"]);
  });
});
