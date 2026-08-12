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
 * 常驻挂载：App 两种视图都渲染，设置页改主题即时生效。
 */
export function ThemeManager({ dark }: { dark: boolean }) {
  const kernel = useKernel();
  const [tick, setTick] = useState(0);

  // 主题贡献变化 → 重应用
  useEffect(() => {
    const off = kernel.registry.onChange("theme", () => setTick((t) => t + 1));
    return off;
  }, [kernel]);

  // T2：用 tick 而非 themes 数组作依赖（数组每次渲染新建，避免每次都重跑）
  useEffect(() => {
    const mode = dark ? "dark" : "light";
    const css = kernel.registry
      .query<ThemeContribution>("theme")
      .filter((c) => !c.value.mode || c.value.mode === mode)
      .map((c) => c.value.css)
      .join("\n");

    let el = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
    if (!el) {
      el = document.createElement("style");
      el.id = STYLE_ID;
      document.head.appendChild(el);
    }
    el.textContent = css;
  }, [kernel, dark, tick]);

  return null;
}
