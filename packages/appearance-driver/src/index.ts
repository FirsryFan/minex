import type { DriverContext } from "@minex/kernel";

interface AppearanceSettings {
  primaryColor?: string;
  backgroundColor?: string;
  warningColor?: string;
  dangerColor?: string;
  zhFont?: string;
  enFont?: string;
  iconTheme?: string;
  customCss?: string;
}

/** 字体名加引号（含空格字体名如 "Microsoft YaHei" 必须引号） */
function quoteFont(name: string): string {
  return name.startsWith('"') || name.startsWith("'") ? name : `"${name}"`;
}

/** 由主题全局设置生成 CSS 覆盖块（浅/深各一份）+ 追加自定义 CSS。纯函数可测。 */
export function buildCss(mode: "dark" | "light", s: AppearanceSettings): string {
  const sel = mode === "dark" ? '[data-theme="dark"]' : ":root";
  const lines: string[] = [];
  if (s.primaryColor) lines.push(`  --color-primary: ${s.primaryColor};`);
  if (s.backgroundColor) lines.push(`  --color-bg: ${s.backgroundColor};`);
  if (s.warningColor) lines.push(`  --color-warning: ${s.warningColor};`);
  if (s.dangerColor) lines.push(`  --color-danger: ${s.dangerColor};`);

  // 全局字体：中文 + 英文（UI 与内容统一）
  const font = [s.enFont, s.zhFont].filter(Boolean).map(quoteFont).join(", ");
  if (font) lines.push(`  --font-ui: ${font}, system-ui, sans-serif;`);
  if (font) lines.push(`  --font-content: ${font}, system-ui, sans-serif;`);

  let css = `${sel} {\n${lines.join("\n")}\n}`;
  if (s.customCss) css += `\n${s.customCss}`;
  return css;
}

interface Theme {
  id: string;
  settings?: Record<string, unknown>;
}

/**
 * 外观驱动：贡献 theme（浅/深 CSS）+ settingsView（惰性加载 React 组件）。
 * - 主题设置存 storage "themes"，当前激活主题存 "activeThemeId"。
 * - 收到 minex:dataChanged 后重注册 theme（外壳随即重应用）。
 * - settingsView 惰性 import：Node(CLI) 宿主不调用 load()，不加载 React。
 */
export default {
  async activate(ctx: DriverContext) {
    const apply = (): void => {
      const themes = (ctx.storage.get("themes") ?? []) as Theme[];
      const activeId = (ctx.storage.get("activeThemeId") ?? "default") as string;
      const theme = themes.find((t) => t.id === activeId) ?? themes[0];
      const settings = (theme?.settings ?? {}) as AppearanceSettings;

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

    // settingsView：惰性加载 React 组件（Node 宿主永不触发）
    ctx.register("settingsView", "minex.appearance", {
      load: () => import("./settings-view.js"),
    });

    const off = ctx.on("minex:dataChanged", () => apply());
    return () => off();
  },
};
