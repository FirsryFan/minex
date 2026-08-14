/**
 * F4（反馈 4）图谱纯净圆圈编码——纯函数，可测。
 * 圆节点去文字后，用三通道编码信息（零模型改动，数据均可推导/已有）：
 * - 大小 = 消息轮数（nodeCount）：对数刻度，n=0→12px … ≥63→30px 封顶（差 10 倍消息量只差几像素）
 * - 颜色 = 活跃度（updatedAt 距今）：hue 固定主题蓝 215，饱和度随 ageDays 衰减，0 天→85%、~17.5 天→15% 持平（灰蓝）
 * - 边框 = 重要度（子会话数 childCount）：0→2px / 1-2→3.5px / ≥3→5px，边框色加深 sat+15
 * now 由调用方注入（默认 Date.now()），测试传固定值，禁 wall-clock 断言。
 */
export interface NodeVisualInput {
  nodeCount: number; // 消息轮数（>=0）
  updatedAt: string; // ISO 时间（活跃度数据源；空串/非法按 0 天处理）
  childCount: number; // 子会话数（图谱推导，graph-view 组装；>=0）
  now?: number; // 可注入时间（测试），默认 Date.now()
}

export interface NodeVisual {
  radius: number; // px（直径 = radius×2），12..30
  fill: string; // hsl(215, sat%, 52%)
  borderWidth: number; // px：2 / 3.5 / 5
  borderColor: string; // hsl(215, min(100, sat+15)%, 40%)
}

export const MAX_RADIUS = 30; // 半径封顶，graph-view 几何统一用此值
const HUE = 215;
const DAY_MS = 86_400_000;
const LOG2_65 = Math.log2(65);

export function encodeNodeVisual(input: NodeVisualInput): NodeVisual {
  const nodeCount = Math.max(0, input.nodeCount);
  const ratio = Math.min(1, Math.log2(1 + nodeCount) / LOG2_65);
  const radius = Math.round(12 + 18 * ratio);

  const now = input.now ?? Date.now();
  const ts = Date.parse(input.updatedAt);
  const ageDays = Number.isFinite(ts) ? Math.max(0, (now - ts) / DAY_MS) : 0; // 负 age 防御 + 非法时间按 0
  const sat = Math.max(15, Math.round(85 - ageDays * 4)); // 0 天→85 … ~17.5 天→15 持平

  const childCount = Math.max(0, input.childCount);
  const borderWidth = childCount === 0 ? 2 : childCount <= 2 ? 3.5 : 5;

  return {
    radius,
    fill: `hsl(${HUE}, ${sat}%, 52%)`,
    borderWidth,
    borderColor: `hsl(${HUE}, ${Math.min(100, sat + 15)}%, 40%)`,
  };
}
