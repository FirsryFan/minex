import { marked } from "marked";

/** markdown → HTML 渲染（纯函数，供通用 markdown 能力复用）。 */
export function renderMarkdown(md: string): string {
  // 同步渲染；marked v12 默认同步返回 string
  return marked.parse(md, { async: false }) as string;
}
