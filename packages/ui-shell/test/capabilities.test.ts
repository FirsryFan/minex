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
import graphDriver from "../../graph-driver/src/index.js";
import appearanceManifest from "../../appearance-driver/manifest.json";
import filesystemManifest from "../../filesystem-driver/manifest.json";
import markdownManifest from "../../markdown-driver/manifest.json";
import sessionManifest from "../../session-driver/manifest.json";
import graphManifest from "../../graph-driver/manifest.json";
import { bootDrivers } from "../src/boot.js";
import { collectCapabilities, type CapabilityContribution, type CapabilityOrigin } from "../src/capabilities.js";

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
    { manifest: graphManifest as unknown as DriverManifest, activate: graphDriver.activate },
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

/** queryAll() 按 driverId 分组（裁决 #1 恒等式主断言的参照：collectCapabilities 输出必须 === 它）。 */
function groupByDriver(kernel: MinexKernel): Map<string, CapabilityContribution[]> {
  const m = new Map<string, CapabilityContribution[]>();
  for (const c of kernel.registry.queryAll()) {
    const list = m.get(c.driverId) ?? [];
    list.push({ type: c.type, id: c.id, origin: c.origin });
    m.set(c.driverId, list);
  }
  return m;
}

/** 顺序无关归一（交叉核对用：query 按 priority 排序、queryAll 按插入序，比较时归一）。 */
function norm(list: CapabilityContribution[]): string[] {
  return [...list].map((c) => `${c.type}/${c.id}/${c.origin}`).sort();
}

describe("collectCapabilities", () => {
  it("真实驱动集成：输出 === queryAll() 按 driver 分组（恒等式）；session/session.md/panel 全部可见", async () => {
    const kernel = createKernel({ storage: createInMemoryStorage() });
    const problems = await bootDrivers(kernel, realDrivers()); // 走真实入口：boot → register → activate
    expect(problems).toEqual([]);

    const caps = collectCapabilities(kernel);
    expect(caps.map((d) => d.driverId)).toEqual([
      "minex.filesystem",
      "mist.session",
      "minex.markdown",
      "minex.appearance",
      "minex.graph",
    ]);

    // 恒等式主断言（裁决 #1）：输出 === queryAll() 按 driver 分组——任何新 type 自动进聚合
    const byDriver = groupByDriver(kernel);
    for (const d of caps) {
      expect(d.contributions).toEqual(byDriver.get(d.driverId) ?? []);
    }
    // 无静默丢弃：聚合总数 === queryAll 总数
    expect(caps.reduce((n, d) => n + d.contributions.length, 0)).toBe(kernel.registry.queryAll().length);

    // queryAll 与逐 type query 交叉核对（type 全集从 queryAll 推导，不依赖目录快照）：
    // 锁 queryAll ≡ 各 type query 并集（同一 effective 语义）
    const allTypes = [...new Set(kernel.registry.queryAll().map((c) => c.type))];
    for (const d of caps) {
      const perQuery: CapabilityContribution[] = [];
      for (const type of allTypes) {
        for (const c of kernel.registry.query<unknown>(type, { driver: d.driverId })) {
          perQuery.push({ type: c.type, id: c.id, origin: c.origin });
        }
      }
      expect(norm(d.contributions)).toEqual(norm(perQuery));
    }

    // 每驱动贡献的 type 集合（与各驱动 index.ts 实际注册一致）
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
    const appearance = caps.find((d) => d.driverId === "minex.appearance")!;
    expect(appearance.contributions.map((c) => c.id).sort()).toEqual([
      "minex.appearance",
      "minex.appearance.dark",
      "minex.appearance.global",
      "minex.appearance.light",
    ]);
    // 真实驱动全部 runtime 贡献（manifest 无 contributes 静态声明）
    expect(appearance.contributions.every((c) => c.origin === "runtime")).toBe(true);

    // 裁决 #1 翻转断言：mist.session 的 session / session.md / panel 全部可见，不得静默丢弃
    const session = caps.find((d) => d.driverId === "mist.session")!;
    expect(session.contributions.map((c) => c.type)).toContain("session");
    expect(session.contributions.map((c) => c.type)).toContain("session.md");
    expect(session.contributions.map((c) => c.type)).toContain("panel");
    expect(session.contributions.map((c) => c.type)).toContain("session.tree"); // 2-2 会话树能力
    // 3-5：会话系面板（mist.session.graph）已迁移到通用 Graph 画布 → 删除；改为 graphSource「会话树」
    expect(session.contributions.map((c) => c.type).sort()).toEqual([
      "graphSource",
      "panel",
      "session",
      "session.md",
      "session.tree",
    ]);
    expect(session.contributions.map((c) => c.id).sort()).toEqual([
      "default",
      "default",
      "default",
      "mist.session.overview",
      "sessions",
    ]);

    // 3-5 + P2-1：通用 Graph 驱动——graph 能力（default）+ 图谱面板（minex.graph.view）+ 目标示例源（goals）
    const graph = caps.find((d) => d.driverId === "minex.graph")!;
    expect(graph.contributions.map((c) => c.type).sort()).toEqual(["graph", "graphSource", "panel"]);
    expect(graph.contributions.map((c) => c.id).sort()).toEqual(["default", "goals", "minex.graph.view"]);
    expect(graph.contributions.every((c) => c.origin === "runtime")).toBe(true);
  });

  it("多驱动多 type 正常聚合（含目录外新 type：注册表驱动，无需目录）", () => {
    const kernel = makeKernel(["alpha.demo", "beta.demo"], [
      { type: "theme", id: "t1", driverId: "alpha.demo" },
      { type: "panel", id: "p1", driverId: "alpha.demo" },
      { type: "command", id: "cmd1", driverId: "alpha.demo" }, // 目录外 type（旧目录机制会漏）
      { type: "panel", id: "p2", driverId: "beta.demo" },
      { type: "settingsView", id: "sv", driverId: "beta.demo" },
      { type: "custom.brandNew", id: "x", driverId: "beta.demo" }, // 未来新增 type 自动进聚合
    ]);
    const caps = collectCapabilities(kernel);
    expect(caps).toHaveLength(2);
    // 恒等式
    const byDriver = groupByDriver(kernel);
    for (const d of caps) {
      expect(d.contributions).toEqual(byDriver.get(d.driverId) ?? []);
    }
    expect(caps[0].driverId).toBe("alpha.demo");
    expect(caps[0].contributions.map((c) => `${c.type}:${c.id}`).sort()).toEqual([
      "command:cmd1",
      "panel:p1",
      "theme:t1",
    ]);
    expect(caps[1].driverId).toBe("beta.demo");
    expect(caps[1].contributions.map((c) => `${c.type}:${c.id}`).sort()).toEqual([
      "custom.brandNew:x",
      "panel:p2",
      "settingsView:sv",
    ]);
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
    // 恒等式：输出 === queryAll() 分组（同 (type,id) 只一条、origin=runtime）
    const byDriver = groupByDriver(kernel);
    expect(d.contributions).toEqual(byDriver.get("alpha.demo") ?? []);
    const originOf = new Map(d.contributions.map((c) => [c.id, c.origin]));
    expect(originOf.get("t-static")).toBe("static");
    expect(originOf.get("p-runtime")).toBe("runtime");
    expect(originOf.get("t-shadow")).toBe("runtime"); // 有效值 = runtime ?? static
    expect(originOf.size).toBe(3); // 同 (type,id) 只一条（无重复）
  });
});
