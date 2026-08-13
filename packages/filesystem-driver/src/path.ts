/**
 * 路径安全纯函数：所有文件操作限制在选定的根目录内。
 * 拒绝绝对路径与 `..` 逃逸，规范化为相对路径。
 */

/** 规范化相对路径：拒绝 `..` 逃逸，返回以 "/" 分隔的相对路径（根 = ""）。 */
export function resolveSafePath(path: string): string {
  if (path.startsWith("/") || /^[A-Za-z]:/.test(path)) {
    throw new Error(`路径必须是相对路径（拒绝绝对路径）：${path}`);
  }
  const parts = path.split(/[/\\]/).filter((p) => p && p !== ".");
  if (parts.some((p) => p === "..")) {
    throw new Error(`路径越界（含 ".."）：${path}`);
  }
  return parts.join("/");
}

/** 拼接子路径到父路径下（均相对根），返回规范化相对路径。 */
export function joinPath(parent: string, name: string): string {
  const base = resolveSafePath(parent);
  const seg = resolveSafePath(name);
  return base ? `${base}/${seg}` : seg;
}

/** 取父目录（根目录的父 = 根）。 */
export function parentPath(path: string): string {
  const p = resolveSafePath(path);
  const idx = p.lastIndexOf("/");
  return idx === -1 ? "" : p.slice(0, idx);
}

/** 取文件名（路径最后一段）。 */
export function baseName(path: string): string {
  const p = resolveSafePath(path);
  const idx = p.lastIndexOf("/");
  return idx === -1 ? p : p.slice(idx + 1);
}

const MARKDOWN_EXTENSIONS = new Set(["md", "markdown"]);

/**
 * 是否为 markdown 文件（按扩展名 .md / .markdown，忽略大小写）。
 * 隐藏文件（如 ".md"）与无扩展名（如 "a"）视为非 markdown。
 */
export function isMarkdownFile(name: string): boolean {
  const idx = name.lastIndexOf(".");
  if (idx <= 0 || idx === name.length - 1) return false; // 隐藏文件 / 空扩展名
  return MARKDOWN_EXTENSIONS.has(name.slice(idx + 1).toLowerCase());
}

const SESSION_EXTENSIONS = new Set(["ses"]);

/** 是否为 Mist 会话文件（.ses，供 markdown 编辑器原生打开）。 */
export function isSessionFile(name: string): boolean {
  const idx = name.lastIndexOf(".");
  if (idx <= 0 || idx === name.length - 1) return false;
  return SESSION_EXTENSIONS.has(name.slice(idx + 1).toLowerCase());
}
