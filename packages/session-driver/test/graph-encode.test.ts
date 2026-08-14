import { describe, expect, it } from "vitest";
import { encodeNodeVisual, MAX_RADIUS } from "../src/graph-encode.js";

/** 固定 now（2026-03-01T00:00:00Z），全部用例显式注入，禁 wall-clock。 */
const NOW = Date.parse("2026-03-01T00:00:00.000Z");
const day = (d: number): string => new Date(NOW + d * 86_400_000).toISOString();

describe("encodeNodeVisual", () => {
  it("n=0 新会话 0 子：radius 12 / sat 85 / border 2（最小值档）", () => {
    const v = encodeNodeVisual({ nodeCount: 0, updatedAt: day(0), childCount: 0, now: NOW });
    expect(v.radius).toBe(12);
    expect(v.fill).toBe("hsl(215, 85%, 52%)");
    expect(v.borderWidth).toBe(2);
    expect(v.borderColor).toBe("hsl(215, 100%, 40%)");
  });

  it("n=100 旧会话 30 天 3 子：radius 30 封顶 / sat 15 持平 / border 5（峰值档）", () => {
    const v = encodeNodeVisual({ nodeCount: 100, updatedAt: day(-30), childCount: 3, now: NOW });
    expect(v.radius).toBe(MAX_RADIUS);
    expect(v.fill).toBe("hsl(215, 15%, 52%)");
    expect(v.borderWidth).toBe(5);
  });

  it("n=1 边界：radius 15（对数刻度最小非零档）", () => {
    const v = encodeNodeVisual({ nodeCount: 1, updatedAt: day(0), childCount: 0, now: NOW });
    expect(v.radius).toBe(15);
  });

  it("age 负值（updatedAt 在未来）防御：sat 85 不超 100", () => {
    const v = encodeNodeVisual({ nodeCount: 3, updatedAt: day(5), childCount: 1, now: NOW });
    expect(v.fill).toBe("hsl(215, 85%, 52%)"); // clamp 后仍 85，不会 >100
    expect(v.borderWidth).toBe(3.5); // childCount 1 → 中档
  });

  it("边框分档：0→2 / 1-2→3.5 / ≥3→5", () => {
    expect(encodeNodeVisual({ nodeCount: 1, updatedAt: day(0), childCount: 0, now: NOW }).borderWidth).toBe(2);
    expect(encodeNodeVisual({ nodeCount: 1, updatedAt: day(0), childCount: 2, now: NOW }).borderWidth).toBe(3.5);
    expect(encodeNodeVisual({ nodeCount: 1, updatedAt: day(0), childCount: 3, now: NOW }).borderWidth).toBe(5);
  });

  it("radius 封顶边界：n=63 已达 30（log2(64)/log2(65)≈0.996）", () => {
    expect(encodeNodeVisual({ nodeCount: 63, updatedAt: day(0), childCount: 0, now: NOW }).radius).toBe(30);
  });

  it("updatedAt 非法（空串）防御：按 0 天处理，sat 85 不 NaN", () => {
    const v = encodeNodeVisual({ nodeCount: 5, updatedAt: "", childCount: 0, now: NOW });
    expect(v.fill).toBe("hsl(215, 85%, 52%)");
    expect(v.radius).toBeGreaterThan(12);
  });

  it("活跃度衰减可查：0 天鲜亮 85，7 天 57，17.5 天持平 15", () => {
    expect(encodeNodeVisual({ nodeCount: 3, updatedAt: day(0), childCount: 0, now: NOW }).fill).toBe(
      "hsl(215, 85%, 52%)",
    );
    expect(encodeNodeVisual({ nodeCount: 3, updatedAt: day(-7), childCount: 0, now: NOW }).fill).toBe(
      "hsl(215, 57%, 52%)",
    );
    expect(encodeNodeVisual({ nodeCount: 3, updatedAt: day(-18), childCount: 0, now: NOW }).fill).toBe(
      "hsl(215, 15%, 52%)",
    );
  });
});
