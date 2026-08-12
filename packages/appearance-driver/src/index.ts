import type { DriverContext } from "@minex/kernel";

interface AppearanceSettings {
  primaryColor?: string;
  uiFont?: string;
  contentFont?: string;
  codeFont?: string;
}

const DEFAULTS: Required<AppearanceSettings> = {
  primaryColor: "#2563eb",
  uiFont: "",
  contentFont: "",
  codeFont: "",
};

function cssLine(value: string, prop: string): string {
  return value ? `  ${prop}: ${value};\n` : "";
}

/** 由设置生成主题 CSS 覆盖块（深/浅各一份）。浅色 :root，深色 [data-theme="dark"]。 */
function buildCss(mode: "dark" | "light", s: AppearanceSettings): string {
  const sel = mode === "dark" ? '[data-theme="dark"]' : ":root";
  const v = { ...DEFAULTS, ...s };
  return `${sel} {\n${cssLine(v.primaryColor, "--color-primary")}${cssLine(
    v.uiFont,
    "--font-ui",
  )}${cssLine(v.contentFont, "--font-content")}${cssLine(v.codeFont, "--font-code")}}`;
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
