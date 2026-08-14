import { describe, expect, it } from "vitest";
import {
  buildOutlineEntry,
  shouldOutline,
  toOutlineMarkdown,
  type ContextItemLike,
  type OutlineEntryLike,
} from "../src/outline.js";

function items(...contents: Array<string | null>): ContextItemLike[] {
  return contents
    .filter((c): c is string => c !== null)
    .map((c, i) => ({ ref: `n${i}`, content: c }));
}

describe("shouldOutline", () => {
  it("空 context → false", () => {
    expect(shouldOutline([])).toBe(false);
  });

  it("全空内容 → false（不污染大纲）", () => {
    expect(shouldOutline([{ ref: "a", content: "  " }, { ref: "b", content: "" }])).toBe(false);
  });

  it("有 user/assistant 实质内容 → true", () => {
    expect(shouldOutline(items("你好"))).toBe(true);
    expect(shouldOutline([{ ref: "a", content: "" }, { ref: "b", content: "实质内容" }])).toBe(true);
  });
});

describe("buildOutlineEntry", () => {
  it("正常：kind=context、summary=首条内容、payload=行式标记 t:/k:", () => {
    const e = buildOutlineEntry(items("今天讨论了会话树设计方案", "还聊了大纲记忆"), "2026-01-01T00:00:00.000Z");
    expect(e.kind).toBe("context");
    expect(e.summary).toBe("今天讨论了会话树设计方案");
    expect(e.payload).toBe("t: 今天讨论了会话树设计方案\nk: 今天讨论了会话树设计方案");
    expect(e.ts).toBe("2026-01-01T00:00:00.000Z");
    expect(e.sourceNodeIds).toEqual(["n0", "n1"]);
    expect(typeof e.id).toBe("string");
  });

  it("超长截断：summary 80 字、t 20 字", () => {
    const long = "长".repeat(200);
    const e = buildOutlineEntry(items(long), "t0");
    expect(e.summary).toHaveLength(80);
    expect(e.summary).toBe(long.slice(0, 80));
    expect(e.payload.startsWith(`t: ${long.slice(0, 20)}`)).toBe(true);
  });

  it("首条为空 → 取下一个实质条目；sourceNodeIds 剔除 parent:tail", () => {
    const e = buildOutlineEntry(
      [
        { ref: "parent:tail", content: "" },
        { ref: "parent:tail", content: "有效内容" },
        { ref: "n5", content: "更多" },
      ],
      "t0",
    );
    expect(e.summary).toBe("有效内容");
    expect(e.sourceNodeIds).toEqual(["n5"]);
  });

  it("全部为空 → summary 空（shouldOutline 已前置拦截）", () => {
    const e = buildOutlineEntry([{ ref: "a", content: "" }], "t0");
    expect(e.summary).toBe("");
    expect(e.payload).toBe("t: \nk: ");
  });
});

describe("toOutlineMarkdown", () => {
  function entry(payload: string, sourceBranchId?: string): OutlineEntryLike {
    return { id: "o1", ts: "t0", kind: "context", summary: "s", payload, sourceBranchId };
  }

  it("正常渲染 payload", () => {
    expect(toOutlineMarkdown(entry("t: 主题\nk: 要点"))).toBe("t: 主题\nk: 要点");
  });

  it("含 sourceBranchId → 追加 branch 行", () => {
    expect(toOutlineMarkdown(entry("t: 主题", "main"))).toBe("t: 主题\nbranch: main");
  });

  it("空 payload → 空字符串", () => {
    expect(toOutlineMarkdown(entry(""))).toBe("");
  });
});
