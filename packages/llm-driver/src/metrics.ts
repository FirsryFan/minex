import type { LLMUsage } from "./types.js";

/** 计量条目（S5c） */
export interface LLMMetricsEntry {
  model: string;
  promptTokens: number;
  completionTokens: number;
  cachedTokens: number;
  ttftMs: number;
  totalMs: number;
  cost: number;
  hitRate: number;
}

/** 价格表：按模型区分 hit（缓存命中）/ miss（未命中）价，单位「每 1M token 美元」。 */
export interface LLMPrices {
  hit: number;
  miss: number;
}

/**
 * 计费：命中 token × hit 价 + 未命中 token × miss 价。
 * 未命中 = prompt 未缓存（prompt - cached）+ completion。价格「每 1M token 美元」，输出美元。
 */
export function computeCost(usage: LLMUsage, prices: LLMPrices): number {
  const hit = Math.max(0, usage.cachedTokens);
  const miss = Math.max(0, usage.promptTokens - usage.cachedTokens + usage.completionTokens);
  return (hit / 1_000_000) * prices.hit + (miss / 1_000_000) * prices.miss;
}

/** 缓存命中率 = cached / prompt；prompt 为 0 时返回 0。 */
export function computeHitRate(cachedTokens: number, promptTokens: number): number {
  if (promptTokens <= 0) return 0;
  return cachedTokens / promptTokens;
}
