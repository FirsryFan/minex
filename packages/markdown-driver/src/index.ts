import type { DriverContext } from "@minex/kernel";
import { renderMarkdown } from "./markdown.js";

const CODE_FONTS = ["Cascadia Code", "JetBrains Mono", "Consolas", "Courier New", "Fira Code", "Source Code Pro", "Ubuntu Mono", "Menlo", "Monaco"];
const EN_FONTS = ["Arial", "Georgia", "Times New Roman", "Verdana", "Tahoma", "Trebuchet MS", "Segoe UI", "Roboto", "Open Sans"];
const ZH_FONTS = ["PingFang SC", "Microsoft YaHei", "SimHei", "SimSun", "Songti SC", "KaiTi", "FangSong", "Noto Sans CJK SC"];

interface MarkdownSettings {
  docEnFont?: string;
  docZhFont?: string;
  fontSize?: number;
  codeFont?: string;
  codeWrap?: boolean;
  lineHeight?: number;
  headingColor?: string;
  linkColor?: string;
}

function quoteFont(name: string): string {
  return name.startsWith('"') || name.startsWith("'") ? name : `"${name}"`;
}

/** 由 markdown 设置生成 CSS（文档字体 / 缩放 / 代码块字体 / 换行），覆盖 CSS 变量。纯函数可测。 */
export function buildMarkdownCss(s: MarkdownSettings): string {
  const lines: string[] = [];
  const docFont = [s.docEnFont, s.docZhFont].filter((f): f is string => Boolean(f)).map(quoteFont).join(", ");
  if (docFont) {
    lines.push(`  --font-md: ${docFont}, var(--font-content, system-ui), sans-serif;`);
    lines.push(`  --font-content: ${docFont}, var(--font-ui, system-ui), sans-serif;`);
  }
  if (s.fontSize && s.fontSize !== 14) lines.push(`  --md-font-size: ${s.fontSize}px;`);
  if (s.codeFont) lines.push(`  --font-code: "${s.codeFont}", ui-monospace, monospace;`);
  if (s.codeWrap) lines.push(`  --md-code-wrap: pre-wrap;`);
  if (s.lineHeight && s.lineHeight !== 1.6) lines.push(`  --md-line-height: ${s.lineHeight};`);
  if (s.headingColor) lines.push(`  --md-heading-color: ${s.headingColor};`);
  if (s.linkColor) lines.push(`  --md-link-color: ${s.linkColor};`);
  return lines.length > 0 ? `:root {\n${lines.join("\n")}\n}` : "";
}

/**
 * Markdown 编辑器驱动：贡献能力。
 * 1. markdown.render —— 通用 markdown→HTML 渲染（供 README 等复用）
 * 2. theme —— 编辑器外观 CSS（文档字体/缩放/代码块字体/换行，设置保存后重注册）
 * 3. workspace —— 工作区视图（编辑/预览/分屏）
 * 4. settingsView —— 编辑器设置
 */
export default {
  async activate(ctx: DriverContext) {
    ctx.register("markdown", "render", { render: renderMarkdown });

    const applyCss = (): void => {
      const s: MarkdownSettings = {
        docEnFont: (ctx.storage.get("docEnFont") ?? "") as string,
        docZhFont: (ctx.storage.get("docZhFont") ?? "") as string,
        fontSize: Number(ctx.storage.get("fontSize") ?? 14) || 14,
        codeFont: (ctx.storage.get("codeFont") ?? "") as string,
        codeWrap: (ctx.storage.get("codeWrap") ?? false) === true || (ctx.storage.get("codeWrap") ?? false) === "on",
        lineHeight: Number(ctx.storage.get("lineHeight") ?? 1.6) || 1.6,
        headingColor: (ctx.storage.get("headingColor") ?? "") as string,
        linkColor: (ctx.storage.get("linkColor") ?? "") as string,
      };
      ctx.register("theme", "minex.markdown.css", {
        id: "minex.markdown.css",
        name: "Markdown Editor",
        css: buildMarkdownCss(s),
      });
    };
    applyCss();

    // 注册到 appearance「驱动设置」扩展点（markdown 编辑器外观条目）
    ctx.register("appearance.driverSetting", "minex.markdown", {
      driverId: "minex.markdown",
      title: "Markdown 编辑器",
      items: [
        { key: "docEnFont", label: "文档英文", type: "font", enum: EN_FONTS, default: "" },
        { key: "docZhFont", label: "文档中文", type: "font", enum: ZH_FONTS, default: "" },
        { key: "fontSize", label: "文档字号", type: "select", enum: ["12", "14", "16", "18", "20"], default: "14" },
        { key: "lineHeight", label: "行距", type: "select", enum: ["1.4", "1.6", "1.8", "2.0", "2.2"], default: "1.6" },
        { key: "headingColor", label: "标题颜色", type: "color", default: "" },
        { key: "linkColor", label: "链接颜色", type: "color", default: "" },
        { key: "codeFont", label: "代码块字体", type: "font", enum: CODE_FONTS, default: "" },
        { key: "codeWrap", label: "代码块换行", type: "select", enum: ["off", "on"], default: "off" },
      ],
    });

    // 面板：markdown 工作区（主区，活动驱动为 markdown 时显示）
    ctx.register("panel", "minex.markdown.workspace", {
      driverId: "minex.markdown",
      id: "minex.markdown.workspace",
      title: "Markdown",
      defaultDock: "main",
      load: () => import("./workspace-view.js"),
    });
    ctx.register("settingsView", "minex.markdown", { load: () => import("./settings-view.js") });

    const off = ctx.on("minex:dataChanged", () => applyCss());
    return () => off();
  },
};
