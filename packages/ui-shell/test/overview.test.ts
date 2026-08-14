import { describe, expect, it } from "vitest";
import { countDependents, type OverviewDriverLike } from "../src/overview.js";

function drivers(list: Array<{ id: string; dependencies?: string[] }>): OverviewDriverLike[] {
  return list.map((d) => ({ manifest: { id: d.id, dependencies: d.dependencies } }));
}

describe("countDependents", () => {
  it("正常：多个驱动依赖 target → 计数", () => {
    const ds = drivers([
      { id: "a", dependencies: ["target.demo"] },
      { id: "b", dependencies: ["target.demo", "x.demo"] },
      { id: "c" },
    ]);
    expect(countDependents(ds, "target.demo")).toBe(2);
  });

  it("无人依赖 → 0", () => {
    const ds = drivers([{ id: "a" }, { id: "b", dependencies: ["c.demo"] }]);
    expect(countDependents(ds, "target.demo")).toBe(0);
  });

  it("自依赖不计（被依赖 = 其他驱动引用数）", () => {
    const ds = drivers([{ id: "self.demo", dependencies: ["self.demo"] }]);
    expect(countDependents(ds, "self.demo")).toBe(0);
  });

  it("dependencies 缺失视为空数组", () => {
    const ds = drivers([{ id: "a" }]);
    expect(countDependents(ds, "a")).toBe(0);
  });
});
