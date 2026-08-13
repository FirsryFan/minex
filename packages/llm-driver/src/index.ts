import type { DriverContext } from "@minex/kernel";
import { createDeepSeekProvider } from "./deepseek.js";
import type { LLMMetricsEntry, LLMPrices } from "./metrics.js";
import type { LLMChunk, LLMProvider, LLMRequest } from "./types.js";

/** LLM 配置能力：apiKey / model / 默认参数 / 价格表（按模型区分，不写死默认） */
interface LLMConfig {
  getApiKey(): string;
  setApiKey(key: string): void;
  getModel(): string;
  setModel(model: string): void;
  getParams(): Record<string, unknown>;
  setParams(params: Record<string, unknown>): void;
  getPrices(): Record<string, LLMPrices>;
  setPrices(prices: Record<string, LLMPrices>): void;
}

/** 计量能力：record 追加、list 读取聚合 */
interface LLMMetrics {
  record(entry: LLMMetricsEntry): void;
  list(model?: string): LLMMetricsEntry[];
}

/**
 * LLM 接入驱动（id: minex.llm）。
 * S5a：`llm.config`（配置）+ `llm`（Provider，从 config 读 key，无 key 抛错）。
 * S5c：`llm.metrics`（计量记录，存储 `minex.llm/metrics`）。
 */
export default {
  async activate(ctx: DriverContext) {
    // —— 配置能力 ——
    const config: LLMConfig = {
      getApiKey: () => (ctx.storage.get("apiKey") as string) ?? "",
      setApiKey: (k) => ctx.storage.set("apiKey", k),
      getModel: () => (ctx.storage.get("model") as string) ?? "",
      setModel: (m) => ctx.storage.set("model", m),
      getParams: () => (ctx.storage.get("params") as Record<string, unknown>) ?? {},
      setParams: (p) => ctx.storage.set("params", p),
      getPrices: () => (ctx.storage.get("prices") as Record<string, LLMPrices>) ?? {},
      setPrices: (p) => ctx.storage.set("prices", p),
    };
    ctx.register("llm.config", "default", config);

    // —— LLM 能力：动态读 key 建 provider（后配置 key 也能生效），无 key 抛错 ——
    const provider: LLMProvider = {
      async *stream(req: LLMRequest): AsyncIterable<LLMChunk> {
        const key = config.getApiKey();
        if (!key) throw new Error("未配置 API key");
        const p = createDeepSeekProvider(key);
        yield* p.stream(req);
      },
    };
    ctx.register("llm", "deepseek", provider);

    // —— 计量能力 ——
    const metrics: LLMMetrics = {
      record(entry) {
        const list = (ctx.storage.get("metrics") as LLMMetricsEntry[]) ?? [];
        ctx.storage.set("metrics", [...list, entry]);
      },
      list(model) {
        const list = (ctx.storage.get("metrics") as LLMMetricsEntry[]) ?? [];
        return model ? list.filter((e) => e.model === model) : list;
      },
    };
    ctx.register("llm.metrics", "default", metrics);

    return () => {};
  },
};
