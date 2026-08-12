/**
 * "a.b.c" 版本比较。语义：
 * - 数字段按数值比较；
 * - 任一侧为非数字段时，该段按字符串比较（确定性，不再静默判等）。
 * 返回：a > b → 1，等于 → 0，小于 → -1。
 */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(".");
  const pb = b.split(".");
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const sa = pa[i] ?? "0";
    const sb = pb[i] ?? "0";
    const na = Number(sa);
    const nb = Number(sb);
    if (Number.isFinite(na) && Number.isFinite(nb)) {
      if (na > nb) return 1;
      if (na < nb) return -1;
    } else if (sa !== sb) {
      // 非数字段：字符串比较
      return sa > sb ? 1 : -1;
    }
  }
  return 0;
}
