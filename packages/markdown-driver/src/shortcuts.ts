/**
 * Markdown 编辑快捷键（Typora 风格）纯函数。
 * 输入：文档文本 + 选区，输出：应用格式后的文本 + 新选区。
 */

export type FormatAction =
  | "bold"
  | "italic"
  | "code"
  | "strike"
  | "heading1"
  | "heading2"
  | "heading3"
  | "heading4"
  | "heading5"
  | "heading6"
  | "quote"
  | "unorderedList"
  | "orderedList";

export interface FormatResult {
  text: string;
  selectionStart: number;
  selectionEnd: number;
}

/** 行内包裹：选中文本 → 包裹符 */
function wrapInline(doc: string, start: number, end: number, open: string, close: string): FormatResult {
  const selected = doc.slice(start, end) || "文本";
  const text = doc.slice(0, start) + open + selected + close + doc.slice(end);
  return { text, selectionStart: start + open.length, selectionEnd: start + open.length + selected.length };
}

/** 行级前缀：选区的每一行加前缀（标题 #、引用 >、列表 - / 1.） */
function prefixLines(doc: string, start: number, end: number, prefix: string, numbered = false): FormatResult {
  const lineStart = doc.lastIndexOf("\n", start - 1) + 1;
  const lineEndRaw = doc.indexOf("\n", end);
  const lineEnd = lineEndRaw === -1 ? doc.length : lineEndRaw;
  const block = doc.slice(lineStart, lineEnd);
  const lines = block.split("\n");
  const out = lines
    .map((ln, i) => (numbered ? `${i + 1}. ${ln}` : `${prefix}${ln}`))
    .join("\n");
  const text = doc.slice(0, lineStart) + out + doc.slice(lineEnd);
  return { text, selectionStart: lineStart, selectionEnd: lineStart + out.length };
}

export function applyFormat(doc: string, start: number, end: number, action: FormatAction): FormatResult {
  switch (action) {
    case "bold":
      return wrapInline(doc, start, end, "**", "**");
    case "italic":
      return wrapInline(doc, start, end, "*", "*");
    case "code":
      return wrapInline(doc, start, end, "`", "`");
    case "strike":
      return wrapInline(doc, start, end, "~~", "~~");
    case "heading1":
      return prefixLines(doc, start, end, "# ");
    case "heading2":
      return prefixLines(doc, start, end, "## ");
    case "heading3":
      return prefixLines(doc, start, end, "### ");
    case "heading4":
      return prefixLines(doc, start, end, "#### ");
    case "heading5":
      return prefixLines(doc, start, end, "##### ");
    case "heading6":
      return prefixLines(doc, start, end, "###### ");
    case "quote":
      return prefixLines(doc, start, end, "> ");
    case "unorderedList":
      return prefixLines(doc, start, end, "- ");
    case "orderedList":
      return prefixLines(doc, start, end, "", true);
  }
}

/** 键盘事件 → 格式化动作（Typora 风格，支持 Ctrl/Cmd）。返回 null 表示不处理。 */
export function shortcutToAction(e: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; key: string }): FormatAction | null {
  const mod = e.ctrlKey || e.metaKey;
  if (!mod) return null;
  const k = e.key.toLowerCase();
  if (e.shiftKey) {
    if (k === "c") return "quote";
    if (k === "k") return "code";
    if (k === "x") return "strike";
    return null;
  }
  if (k === "b") return "bold";
  if (k === "i") return "italic";
  if (k === "l") return "unorderedList";
  if (k === "o") return "orderedList";
  if (k === "1") return "heading1";
  if (k === "2") return "heading2";
  if (k === "3") return "heading3";
  if (k === "4") return "heading4";
  if (k === "5") return "heading5";
  if (k === "6") return "heading6";
  return null;
}
