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

/**
 * 价格表：按模型区分三档价，单位「每 1M token 美元」。
 * 真实 DeepSeek-chat：输入缓存命中 $0.07 / 输入未命中 $0.27 / 输出 $1.10（输出约输入 miss 的 4 倍，不可混价）。
 */
export interface LLMPrices {
  /** 输入缓存命中价 */
  inputHit: number;
  /** 输入缓存未命中价 */
  inputMiss: number;
  /** 输出价 */
  output: number;
}

/**
 * 计费（三档）：命中输入 × inputHit + 未命中输入 × inputMiss + 输出 × output。
 * 价格「每 1M token 美元」，输出美元。审查 MAJOR-3：输出独立计价，避免两档低估。
 */
export function computeCost(usage: LLMUsage, prices: LLMPrices): number {
  const hit = Math.max(0, usage.cachedTokens);
  const miss = Math.max(0, usage.promptTokens - usage.cachedTokens);
  const output = Math.max(0, usage.completionTokens);
  return (hit / 1_000_000) * prices.inputHit + (miss / 1_000_000) * prices.inputMiss + (output / 1_000_000) * prices.output;
}

/** 缓存命中率 = cached / prompt；prompt 为 0 时返回 0；clamp 到 [0,1]（防御 cached>prompt 异常）。 */
export function computeHitRate(cachedTokens: number, promptTokens: number): number {
  if (promptTokens <= 0) return 0;
  return Math.min(1, Math.max(0, cachedTokens / promptTokens));
}
