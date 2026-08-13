import { describe, expect, it } from "vitest";
import { hexToHsv, hsvToHex } from "../src/color.js";

describe("hex <-> hsv", () => {
  it("hexToHsv for pure red", () => {
    expect(hexToHsv("#ff0000")).toEqual({ h: 0, s: 100, v: 100 });
  });
  it("hexToHsv for white / black", () => {
    expect(hexToHsv("#ffffff")).toEqual({ h: 0, s: 0, v: 100 });
    expect(hexToHsv("#000000")).toEqual({ h: 0, s: 0, v: 0 });
  });
  it("round-trip", () => {
    const hex = "#3b82f6";
    const { h, s, v } = hexToHsv(hex);
    expect(hsvToHex(h, s, v)).toBe("#3b82f6");
  });
  it("clamps out-of-range", () => {
    expect(hsvToHex(370, 150, -10)).toBe(hsvToHex(10, 100, 0));
  });
});
