import type { LLMChunk, LLMProvider, LLMRequest, LLMUsage, ToolDef } from "./types.js";

const DEEPSEEK_URL = "https://api.deepseek.com/chat/completions";

/**
 * 解析 SSE 行 → 增量 / 结束标记 / null。
 * DeepSeek 流式每行形如 `data: {json}`；`data: [DONE]` 结束。
 * 纯函数可测。
 */
export function parseSseLine(line: string): { delta: string } | { done: true } | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("data:")) return null;
  const data = trimmed.slice(5).trim();
  if (data === "[DONE]") return { done: true };
  try {
    const obj = JSON.parse(data) as { choices?: Array<{ delta?: { content?: unknown } }> };
    const delta = obj.choices?.[0]?.delta?.content;
    if (typeof delta === "string") return { delta };
    return null; // 无 content（可能仅 reasoning 或 usage）
  } catch {
    return null;
  }
}

/** 从流末 chunk payload 提取用量（DeepSeek usage 字段）。纯函数可测。 */
export function extractUsage(payload: unknown): LLMUsage {
  const u = (payload as { usage?: Record<string, unknown> })?.usage ?? {};
  return {
    promptTokens: typeof u.prompt_tokens === "number" ? u.prompt_tokens : 0,
    completionTokens: typeof u.completion_tokens === "number" ? u.completion_tokens : 0,
    cachedTokens: typeof u.prompt_cache_hit_tokens === "number" ? u.prompt_cache_hit_tokens : 0,
  };
}

/** ToolDef → DeepSeek 工具声明（type:"function" 包装） */
function toDeepSeekTool(t: ToolDef): Record<string, unknown> {
  return { type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } };
}

/**
 * 创建 DeepSeek Provider。内含 URL / 鉴权 / SSE 解析 / 缓存计费字段。
 * 无 apiKey 时 stream 抛「未配置 API key」（由上层 llm 能力包装）。
 */
export function createDeepSeekProvider(apiKey: string): LLMProvider {
  async function* stream(req: LLMRequest): AsyncIterable<LLMChunk> {
    if (!apiKey) throw new Error("未配置 API key");
    const body: Record<string, unknown> = {
      model: req.model,
      messages: req.messages,
      ...(req.tools && req.tools.length > 0 ? { tools: req.tools.map(toDeepSeekTool) } : {}),
      ...(req.params ?? {}),
      stream: true,
      stream_options: { include_usage: true },
    };
    const res = await fetch(DEEPSEEK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`DeepSeek API ${res.status}: ${text}`);
    }
    if (!res.body) throw new Error("DeepSeek 响应无 body");

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    let finished = false;
    while (!finished) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, idx);
        buf = buf.slice(idx + 1);
        const parsed = parseSseLine(line);
        if (!parsed) continue;
        if ("done" in parsed) {
          finished = true;
          break;
        }
        if (parsed.delta) yield { delta: parsed.delta, done: false };
      }
    }
    yield { delta: "", done: true };
  }

  return { stream };
}
