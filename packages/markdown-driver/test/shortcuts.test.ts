import { describe, expect, it } from "vitest";
import { applyFormat, shortcutToAction } from "../src/shortcuts.js";

describe("applyFormat", () => {
  it("bold wraps selection", () => {
    const r = applyFormat("hello world", 0, 5, "bold");
    expect(r.text).toBe("**hello** world");
    expect(r.selectionStart).toBe(2);
    expect(r.selectionEnd).toBe(7);
  });
  it("italic wraps empty selection with placeholder", () => {
    const r = applyFormat("", 0, 0, "italic");
    expect(r.text).toBe("*文本*");
  });
  it("heading prefixes current line", () => {
    const r = applyFormat("line one\nline two", 0, 4, "heading2");
    expect(r.text).toBe("## line one\nline two");
  });
  it("unordered list prefixes all lines in block", () => {
    const r = applyFormat("a\nb", 0, 3, "unorderedList");
    expect(r.text).toBe("- a\n- b");
  });
  it("ordered list numbers lines", () => {
    const r = applyFormat("a\nb", 0, 3, "orderedList");
    expect(r.text).toBe("1. a\n2. b");
  });
  it("code wraps selection with backticks", () => {
    const r = applyFormat("let x = 1", 0, 4, "code");
    expect(r.text).toBe("`let `x = 1");
  });
});

describe("shortcutToAction", () => {
  it("maps ctrl+b to bold", () => {
    expect(shortcutToAction({ ctrlKey: true, metaKey: false, shiftKey: false, key: "b" })).toBe("bold");
  });
  it("maps cmd+shift+c to quote", () => {
    expect(shortcutToAction({ ctrlKey: false, metaKey: true, shiftKey: true, key: "C" })).toBe("quote");
  });
  it("returns null without modifier", () => {
    expect(shortcutToAction({ ctrlKey: false, metaKey: false, shiftKey: false, key: "b" })).toBeNull();
  });
});
