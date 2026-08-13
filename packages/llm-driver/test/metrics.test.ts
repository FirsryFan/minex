import { describe, expect, it } from "vitest";
import { computeCost, computeHitRate } from "../src/metrics.js";

describe("computeCost", () => {
  it("all-hit: cached == prompt, no completion", () => {
    // 1M token 全命中：1M × hit 价
    const cost = computeCost(
      { promptTokens: 1_000_000, completionTokens: 0, cachedTokens: 1_000_000 },
      { hit: 0.1, miss: 1.0 },
    );
    expect(cost).toBeCloseTo(0.1, 10);
  });
  it("all-miss: no cache, prompt + completion all miss", () => {
    const cost = computeCost(
      { promptTokens: 1_000_000, completionTokens: 1_000_000, cachedTokens: 0 },
      { hit: 0.1, miss: 1.0 },
    );
    expect(cost).toBeCloseTo(2.0, 10); // 2M × miss 价
  });
  it("mixed: hit + miss split", () => {
    const cost = computeCost(
      { promptTokens: 1_000_000, completionTokens: 500_000, cachedTokens: 400_000 },
      { hit: 0.1, miss: 1.0 },
    );
    // hit=0.4M×0.1=0.04；miss=(1M-0.4M+0.5M)=1.1M×1.0=1.1；合计 1.14
    expect(cost).toBeCloseTo(1.14, 10);
  });
});

describe("computeHitRate", () => {
  it("0% when no cached", () => {
    expect(computeHitRate(0, 100)).toBe(0);
  });
  it("50%", () => {
    expect(computeHitRate(50, 100)).toBeCloseTo(0.5, 10);
  });
  it("100%", () => {
    expect(computeHitRate(100, 100)).toBe(1);
  });
  it("prompt=0 returns 0", () => {
    expect(computeHitRate(10, 0)).toBe(0);
  });
});
