import { describe, expect, it } from "vitest";
import { buildCss } from "../src/index.js";

describe("buildCss", () => {
  it("generates valid CSS with quoted fonts (W2)", () => {
    const css = buildCss("light", {
      primaryColor: "#ff0000",
      uiEnFont: "Arial",
      uiZhFont: "Microsoft YaHei",
      contentEnFont: "Times New Roman",
      contentZhFont: "PingFang SC",
      codeFont: "JetBrains Mono",
    });
    expect(css).toContain(':root {');
    expect(css).toContain('--color-primary: #ff0000;');
    // W2：含空格字体名必须带引号
    expect(css).toContain('"Microsoft YaHei"');
    expect(css).toContain('"Times New Roman"');
    expect(css).toContain('"PingFang SC"');
    expect(css).toContain('"JetBrains Mono"');
    expect(css).toContain('--font-ui: "Arial", "Microsoft YaHei", system-ui, sans-serif;');
    expect(css).toContain('--font-code: "JetBrains Mono", ui-monospace, monospace;');
  });

  it("dark mode uses [data-theme=dark] selector", () => {
    const css = buildCss("dark", { primaryColor: "#00ff00" });
    expect(css).toContain('[data-theme="dark"] {');
    expect(css).not.toContain(":root {");
  });

  it("omits empty settings and appends customCss", () => {
    const css = buildCss("light", { customCss: "/* custom */\n.x { color: red; }" });
    expect(css).not.toContain("--font-ui:");
    expect(css).toContain("/* custom */");
    expect(css).toContain(".x { color: red; }");
  });

  it("does not double-quote already-quoted fonts", () => {
    const css = buildCss("light", { uiEnFont: '"Fira Code"' });
    expect(css).toContain('"Fira Code"');
    expect(css).not.toContain('""Fira Code""');
  });
});
