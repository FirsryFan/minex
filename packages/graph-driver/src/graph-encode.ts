/**
 * 节点大小编码（3-5 §一 关系图改进）：大小 = 消息数对数刻度。
 * radius = round(12 + 18×min(1, log2(1+n)/log2(65)))——n=0→12px … ≥63→30px 封顶。
 * 无填充圆 + 主题色边框 2px；当前会话/选中 = accent ring（画布渲染侧处理）。
 */
export const MAX_RADIUS = 30;

export function encodeNodeRadius(nodeCount: number): number {
  const n = Math.max(0, nodeCount);
  const ratio = Math.min(1, Math.log2(1 + n) / Math.log2(65));
  return Math.round(12 + 18 * ratio);
}
