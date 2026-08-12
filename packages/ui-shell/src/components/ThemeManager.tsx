import { useEffect, useState } from "react";
import { useKernel } from "../kernel-context.js";

interface ThemeContribution {
  id: string;
  name?: string;
  /** 适用模式：缺省 = 两种模式都适用 */
  mode?: "dark" | "light";
  /** CSS 覆盖块（如 ":root { --color-primary: #f00; }"） */
  css: string;
}

const STYLE_ID = "minex-driver-theme";

/**
 * 主题管理器：消费驱动的 `theme` 贡献，把匹配当前模式的 CSS 注入 <style>。
 * 系统默认（theme.css 浅色 + [data-theme=dark] 深色）在主题管理器之前，
 * 注入的 <style> 在后 → 同特异性选择器后胜，驱动主题覆盖默认。
 */
export function ThemeManager({ dark }: { dark: boolean }) {
  const kernel = useKernel();
  const [, setTick] = useState(0);

  // 主题贡献变化 → 重应用
  useEffect(() => {
    const off = kernel.registry.onChange("theme", () => setTick((t) => t + 1));
    return off;
  }, [kernel]);

  const mode = dark ? "dark" : "light";
  const themes = kernel.registry
    .query<ThemeContribution>("theme")
    .filter((c) => !c.value.mode || c.value.mode === mode);

  useEffect(() => {
    let el = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
    if (!el) {
      el = document.createElement("style");
      el.id = STYLE_ID;
      document.head.appendChild(el);
    }
    el.textContent = themes.map((t) => t.value.css).join("\n");
  }, [mode, themes]);

  return null;
}
