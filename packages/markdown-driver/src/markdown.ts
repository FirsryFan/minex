import hljs from "highlight.js";
import { Marked } from "marked";
import markedKatex from "marked-katex-extension";

export interface RenderOptions {
  /** 代码块语法高亮 */
  codeHighlight?: boolean;
  /** KaTeX 数学公式渲染 */
  katex?: boolean;
}

/**
 * markdown → HTML 渲染（纯函数，供通用 markdown 能力复用）。
 * 用 Marked 实例（非全局单例），避免多次调用累积 renderer/扩展。
 * 高亮用 highlight.js；公式用 marked-katex-extension（$$ / \[ \]）。
 */
export function renderMarkdown(md: string, opts: RenderOptions = {}): string {
  const marked = new Marked();

  if (opts.codeHighlight) {
    marked.use({
      renderer: {
        code(code: string, infostring: string | undefined): string | false {
          const lang = (infostring ?? "").trim().split(/\s+/)[0];
          if (lang && hljs.getLanguage(lang)) {
            const html = hljs.highlight(code, { language: lang }).value;
            return `<pre><code class="hljs language-${lang}">${html}</code></pre>`;
          }
          return false; // 无语言或无匹配 → 走默认渲染
        },
      },
    });
  }

  if (opts.katex) {
    marked.use(markedKatex({ throwOnError: false }));
  }

  return marked.parse(md, { async: false }) as string;
}
