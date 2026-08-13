import type { DriverContext } from "@minex/kernel";

interface AppearanceSettings {
  primaryColor?: string;
  backgroundColor?: string;
  unfinishedColor?: string;
  errorColor?: string;
  uiEnFont?: string;
  uiZhFont?: string;
  contentEnFont?: string;
  contentZhFont?: string;
  codeFont?: string;
  iconTheme?: string;
  customCss?: string;
}

/** 字体名加引号（W2：含空格字体名如 "Microsoft YaHei" 必须引号，否则被解析为两个字体系列静默回退） */
function quoteFont(name: string): string {
  return name.startsWith('"') || name.startsWith("'") ? name : `"${name}"`;
}

/**
 * 由设置生成主题 CSS 覆盖块（浅/深各一份）+ 追加自定义 CSS。
 * 导出为纯函数（可单测）：输入设置对象，输出合法 CSS。
 */
export function buildCss(mode: "dark" | "light", s: AppearanceSettings): string {
  const sel = mode === "dark" ? '[data-theme="dark"]' : ":root";
  const lines: string[] = [];
  if (s.primaryColor) lines.push(`  --color-primary: ${s.primaryColor};`);
  if (s.backgroundColor) lines.push(`  --color-bg: ${s.backgroundColor};`);
  if (s.unfinishedColor) lines.push(`  --color-unfinished: ${s.unfinishedColor};`);
  if (s.errorColor) lines.push(`  --color-error: ${s.errorColor};`);

  const uiFont = [s.uiEnFont, s.uiZhFont].filter(Boolean).map(quoteFont).join(", ");
  if (uiFont) lines.push(`  --font-ui: ${uiFont}, system-ui, sans-serif;`);
  const contentFont = [s.contentEnFont, s.contentZhFont].filter(Boolean).map(quoteFont).join(", ");
  if (contentFont) lines.push(`  --font-content: ${contentFont}, system-ui, sans-serif;`);
  if (s.codeFont) lines.push(`  --font-code: ${quoteFont(s.codeFont)}, ui-monospace, monospace;`);

  let css = `${sel} {\n${lines.join("\n")}\n}`;
  if (s.customCss) css += `\n${s.customCss}`;
  return css;
}

/**
 * 外观驱动：贡献两个 theme（浅/深），外壳 ThemeManager 注入 CSS。
 * 设置保存在 storage config；收到 minex:dataChanged 后重注册主题（外壳随即重应用）。
 */
export default {
  async activate(ctx: DriverContext) {
    const apply = (): void => {
      const settings = (ctx.storage.get("config") ?? {}) as AppearanceSettings;
      ctx.register("theme", "minex.appearance.light", {
        id: "minex.appearance.light",
        name: "Appearance Light",
        mode: "light" as const,
        css: buildCss("light", settings),
      });
      ctx.register("theme", "minex.appearance.dark", {
        id: "minex.appearance.dark",
        name: "Appearance Dark",
        mode: "dark" as const,
        css: buildCss("dark", settings),
      });
    };
    apply();
    const off = ctx.on("minex:dataChanged", () => apply()); // 设置保存后重注册
    return () => off();
  },
};
