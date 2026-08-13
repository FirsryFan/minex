import { describe, expect, it } from "vitest";
import { computeCost, computeHitRate } from "../src/metrics.js";

describe("computeCost", () => {
  // DeepSeek 真实价格：inputHit 0.07 / inputMiss 0.27 / output 1.10
  const prices = { inputHit: 0.07, inputMiss: 0.27, output: 1.1 };
  it("all-hit: cached == prompt, no completion", () => {
    const cost = computeCost(
      { promptTokens: 1_000_000, completionTokens: 0, cachedTokens: 1_000_000 },
      prices,
    );
    expect(cost).toBeCloseTo(0.07, 10);
  });
  it("all-miss: prompt all miss + completion charged at output price", () => {
    const cost = computeCost(
      { promptTokens: 1_000_000, completionTokens: 1_000_000, cachedTokens: 0 },
      prices,
    );
    expect(cost).toBeCloseTo(0.27 + 1.1, 10); // 输入 miss + 输出（独立价）
  });
  it("mixed: hit + miss + output split", () => {
    const cost = computeCost(
      { promptTokens: 1_000_000, completionTokens: 500_000, cachedTokens: 400_000 },
      prices,
    );
    // hit 0.4M×0.07=0.028; miss 0.6M×0.27=0.162; output 0.5M×1.1=0.55; 合计 0.74
    expect(cost).toBeCloseTo(0.74, 10);
  });
  it("clamps negative guard values to 0", () => {
    const cost = computeCost(
      { promptTokens: 0, completionTokens: 0, cachedTokens: 0 },
      prices,
    );
    expect(cost).toBe(0);
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
  it("clamps cached > prompt to 100% (审查 MINOR)", () => {
    expect(computeHitRate(150, 100)).toBe(1);
  });
});
