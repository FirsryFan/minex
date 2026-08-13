import { describe, expect, it } from "vitest";
import { renderMarkdown } from "../src/markdown.js";

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
});
