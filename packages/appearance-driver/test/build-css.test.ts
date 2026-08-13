import { describe, expect, it } from "vitest";
import { buildCss, buildGlobalCss } from "../src/index.js";

describe("buildCss", () => {
  it("generates valid CSS with quoted fonts", () => {
    const css = buildCss("light", {
      primaryColor: "#ff0000",
      enFont: "Arial",
      zhFont: "Microsoft YaHei",
    });
    expect(css).toContain(":root {");
    expect(css).toContain("--color-primary: #ff0000;");
    // 含空格字体名必须带引号
    expect(css).toContain('"Microsoft YaHei"');
    expect(css).toContain('--font-ui: "Arial", "Microsoft YaHei", system-ui, sans-serif;');
    expect(css).toContain('--font-content: "Arial", "Microsoft YaHei", system-ui, sans-serif;');
  });

  it("dark mode uses [data-theme=dark] selector", () => {
    const css = buildCss("dark", { primaryColor: "#00ff00" });
    expect(css).toContain('[data-theme="dark"] {');
    expect(css).not.toContain(":root {");
  });

  it("emits warning/danger colors and omits empty fonts", () => {
    const css = buildCss("light", { warningColor: "#f59e0b", dangerColor: "#ef4444" });
    expect(css).toContain("--color-warning: #f59e0b;");
    expect(css).toContain("--color-danger: #ef4444;");
    expect(css).not.toContain("--font-ui:");
  });

  it("appends customCss", () => {
    const css = buildCss("light", { customCss: "/* custom */\n.x { color: red; }" });
    expect(css).toContain("/* custom */");
    expect(css).toContain(".x { color: red; }");
  });

  it("does not double-quote already-quoted fonts", () => {
    const css = buildCss("light", { enFont: '"Fira Code"' });
    expect(css).toContain('"Fira Code"');
    expect(css).not.toContain('""Fira Code""');
  });

  it("background color derives surface (card) and hover colors", () => {
    const css = buildCss("light", { backgroundColor: "#123456" });
    expect(css).toContain("--color-bg: #123456;");
    expect(css).toContain("--color-card: color-mix(in srgb, #123456 92%, white);");
    expect(css).toContain("--color-hover: color-mix(in srgb, #123456 96%, white);");
  });
});

describe("buildGlobalCss", () => {
  it("emits zoom, animations off, acrylic, background image", () => {
    const css = buildGlobalCss({ zoom: 125, animations: false, acrylic: true, acrylicOpacity: 60, backgroundImage: "https://x/y.png" });
    expect(css).toContain("zoom: 1.25");
    expect(css).toContain("animation: none !important");
    expect(css).toContain("backdrop-filter: blur(20px)");
    expect(css).toContain("background-image: url(https://x/y.png)");
  });
  it("empty settings produce empty css", () => {
    expect(buildGlobalCss({})).toBe("");
  });
  it("default zoom (100) omits zoom rule", () => {
    expect(buildGlobalCss({ zoom: 100 })).toBe("");
  });
});
