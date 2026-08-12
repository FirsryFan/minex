import { describe, expect, it } from "vitest";
import { compareVersions } from "../src/index.js";

describe("compareVersions", () => {
  it("compares numeric versions", () => {
    expect(compareVersions("1.0.0", "1.0.0")).toBe(0);
    expect(compareVersions("1.2.0", "1.1.9")).toBe(1);
    expect(compareVersions("1.1.0", "1.2.0")).toBe(-1);
    expect(compareVersions("1.0", "1.0.1")).toBe(-1); // 缺段视为 0
  });

  it("m2: non-decimal numeric forms are not treated as numbers", () => {
    // Number("0x10")=16 之前被当作数字；现在 "0x10" 非纯十进制 → 走字符串比较，判不等
    expect(compareVersions("1.0.0x10", "1.0.16")).not.toBe(0);
    expect(compareVersions("1.0.1e3", "1.0.1000")).not.toBe(0);
    // 纯十进制（含前导零）正常
    expect(compareVersions("1.0.010", "1.0.10")).toBe(0);
  });

  it("handles non-numeric segments deterministically", () => {
    expect(compareVersions("1.0.abc", "1.0.0")).toBe(1); // "abc" > "0"
    expect(compareVersions("1.0.0", "1.0.abc")).toBe(-1);
    expect(compareVersions("1.2-beta", "1.2.0")).toBe(1); // "2-beta" 非数字 → 字符串比较
  });
});
