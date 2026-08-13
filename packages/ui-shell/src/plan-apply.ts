/**
 * 驱动启用/禁用应用计划（纯函数，可单测）。
 * W1：检测「启用项依赖被禁用项」的冲突，并给出确定性应用顺序。
 */

export interface ApplyStep {
  id: string;
  enabled: boolean;
}

export interface ApplyPlan {
  /** 应用顺序：先禁用（依赖者先于依赖），后启用（依赖先于依赖者） */
  steps: ApplyStep[];
  /** 冲突描述：启用项传递依赖的驱动出现在禁用列表 */
  conflicts: string[];
}

/** 传递依赖闭包（不含自身） */
function transitiveDeps(
  id: string,
  getDependencies: (id: string) => string[],
  seen: Set<string> = new Set(),
): Set<string> {
  const out = new Set<string>();
  for (const dep of getDependencies(id)) {
    if (seen.has(dep)) continue;
    seen.add(dep);
    out.add(dep);
    for (const deep of transitiveDeps(dep, getDependencies, seen)) out.add(deep);
  }
  return out;
}

/** 依赖深度：0 = 无依赖 */
function depth(id: string, getDependencies: (id: string) => string[], seen: Set<string> = new Set()): number {
  if (seen.has(id)) return 0;
  seen.add(id);
  const deps = getDependencies(id);
  if (deps.length === 0) return 0;
  return 1 + Math.max(...deps.map((d) => depth(d, getDependencies, seen)));
}

export function planApply(
  pending: Record<string, boolean>,
  getDependencies: (id: string) => string[],
): ApplyPlan {
  const entries = Object.entries(pending);
  const enableIds = entries.filter(([, e]) => e).map(([id]) => id);
  const disableIds = entries.filter(([, e]) => !e).map(([id]) => id);
  const disableSet = new Set(disableIds);

  // W1：冲突检测——启用项的传递依赖出现在禁用组
  const conflicts: string[] = [];
  for (const id of enableIds) {
    for (const dep of transitiveDeps(id, getDependencies)) {
      if (disableSet.has(dep)) {
        conflicts.push(`启用 "${id}" 需要依赖 "${dep}"，但 "${dep}" 在禁用列表中`);
      }
    }
  }

  // 顺序：先禁用（依赖者先于依赖 = 深度降序），后启用（依赖先于依赖者 = 深度升序）
  const byDepthDesc = (a: string, b: string) => depth(b, getDependencies) - depth(a, getDependencies);
  const byDepthAsc = (a: string, b: string) => depth(a, getDependencies) - depth(b, getDependencies);

  const steps: ApplyStep[] = [
    ...[...disableIds].sort(byDepthDesc).map((id) => ({ id, enabled: false })),
    ...[...enableIds].sort(byDepthAsc).map((id) => ({ id, enabled: true })),
  ];

  return { steps, conflicts };
}
