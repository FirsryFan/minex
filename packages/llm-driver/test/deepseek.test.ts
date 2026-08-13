import { describe, expect, it } from "vitest";
import { extractUsage, parseSseLine } from "../src/deepseek.js";

describe("parseSseLine", () => {
  it("parses delta content line", () => {
    const r = parseSseLine('data: {"choices":[{"delta":{"content":"你好"}}]}');
    expect(r).toEqual({ delta: "你好" });
  });
  it("parses [DONE] as done", () => {
    expect(parseSseLine("data: [DONE]")).toEqual({ done: true });
  });
  it("returns null for non-data / empty / invalid json", () => {
    expect(parseSseLine("")).toBeNull();
    expect(parseSseLine(": keep-alive")).toBeNull();
    expect(parseSseLine("data: not-json")).toBeNull();
    expect(parseSseLine('data: {"choices":[{"delta":{}}]}')).toBeNull(); // 无 content
  });
  it("parses usage chunk (审查 MAJOR-1)", () => {
    const r = parseSseLine('data: {"choices":[],"usage":{"prompt_tokens":100,"completion_tokens":50,"prompt_cache_hit_tokens":30}}');
    expect(r).toEqual({ usage: { promptTokens: 100, completionTokens: 50, cachedTokens: 30 } });
  });
});

describe("extractUsage", () => {
  it("extracts with cache hit field", () => {
    const u = extractUsage({ usage: { prompt_tokens: 100, completion_tokens: 50, prompt_cache_hit_tokens: 30 } });
    expect(u).toEqual({ promptTokens: 100, completionTokens: 50, cachedTokens: 30 });
  });
  it("defaults cachedTokens to 0 when absent", () => {
    const u = extractUsage({ usage: { prompt_tokens: 100, completion_tokens: 50 } });
    expect(u).toEqual({ promptTokens: 100, completionTokens: 50, cachedTokens: 0 });
  });
  it("defaults all to 0 when no usage", () => {
    expect(extractUsage({})).toEqual({ promptTokens: 0, completionTokens: 0, cachedTokens: 0 });
  });
});
