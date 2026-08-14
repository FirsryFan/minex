/**
 * 驱动总览数据辅助（阶段 A2）：纯计算函数，UI 组件层不承载可测逻辑。
 */

/** drivers.list() 的驱动最小结构（仅总览用到的字段） */
export interface OverviewDriverLike {
  manifest: { id: string; dependencies?: string[] };
}

/**
 * 被依赖计数：已加载驱动中「其他驱动」把 driverId 列为 dependencies 的个数。
 * 排除自身（驱动依赖自己属于 manifest 错误，不计入「被依赖」）；dependencies 缺失视为空数组。
 */
export function countDependents(drivers: OverviewDriverLike[], driverId: string): number {
  return drivers.filter(
    (d) => d.manifest.id !== driverId && (d.manifest.dependencies ?? []).includes(driverId),
  ).length;
}
