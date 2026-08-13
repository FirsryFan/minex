import { describe, expect, it } from "vitest";
import { renderMarkdown } from "../src/markdown.js";
import { buildMarkdownCss } from "../src/index.js";

describe("renderMarkdown", () => {
  it("renders headings", () => {
    expect(renderMarkdown("# Title")).toContain("<h1");
  });
  it("renders code blocks", () => {
    expect(renderMarkdown("```ts\nconst a = 1;\n```")).toContain("<pre>");
  });
  it("renders lists and blockquotes", () => {
    const html = renderMarkdown("- a\n- b\n\n> quote");
    expect(html).toContain("<li>");
    expect(html).toContain("<blockquote>");
  });
  it("renders inline code and bold", () => {
    const html = renderMarkdown("**bold** and `code`");
    expect(html).toContain("<strong>");
    expect(html).toContain("<code>");
  });
  it("renders highlighted code with language", () => {
    const html = renderMarkdown("```ts\nconst a = 1;\n```", { codeHighlight: true });
    expect(html).toContain("hljs");
  });
  it("renders KaTeX math when enabled", () => {
    const html = renderMarkdown("$E = mc^2$", { katex: true });
    expect(html).toContain("katex");
  });
});


describe("buildMarkdownCss", () => {
  it("emits doc font, size, code font, wrap", () => {
    const css = buildMarkdownCss({ docEnFont: "Georgia", docZhFont: "SimSun", fontSize: 16, codeFont: "Fira Code", codeWrap: true });
    expect(css).toContain("--font-md");
    expect(css).toContain('"Georgia"');
    expect(css).toContain("--md-font-size: 16px");
    expect(css).toContain('"Fira Code"');
    expect(css).toContain("--md-code-wrap: pre-wrap");
  });
  it("empty settings produce empty css", () => {
    expect(buildMarkdownCss({})).toBe("");
  });
  it("default fontSize (14) omits size rule", () => {
    const css = buildMarkdownCss({ fontSize: 14, codeFont: "Consolas" });
    expect(css).not.toContain("--md-font-size");
    expect(css).toContain("Consolas");
  });
});
