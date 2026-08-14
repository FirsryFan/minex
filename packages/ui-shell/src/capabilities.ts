/**
 * 驱动能力总览数据管道（阶段 A1 · 裁决 #1 后返工版）：按驱动聚合 registry 贡献的纯函数。
 *
 * 注册表驱动：从 `kernel.registry.queryAll()` 一次枚举全部**有效贡献**
 * （effective = runtime ?? static），按 driverId 分组——任何新能力 type 自动进聚合，
 * 外壳不维护 type 目录（裁决 #1：内核只给机制、外壳不认识内容语义）。
 * 消费的是贡献元数据（type/id/origin）——这里要的就是贡献清单本身，
 * 与「取能力值才 .map(c => c.value)」的宿主视图纪律不冲突。
 * 纯函数：不触碰 DOM / React / 事件，输入 kernel 结构、输出普通数据。
 */

/** 贡献来源（与内核 ContributionOrigin 同值，内核未 re-export 该类型，本地声明） */
export type CapabilityOrigin = "static" | "runtime";

/** 贡献清单条目（贡献元数据，不含 value） */
export interface CapabilityContribution {
  type: string;
  id: string;
  origin: CapabilityOrigin;
}

/** 按驱动聚合的贡献清单 */
export interface DriverCapabilities {
  driverId: string;
  contributions: CapabilityContribution[];
}

/** kernel 最小结构（结构类型：registry 宿主视图 queryAll + 已加载驱动清单） */
export interface CapabilityKernelLike {
  registry: {
    queryAll(): Array<{
      type: string;
      id: string;
      driverId: string;
      origin: CapabilityOrigin;
      value: unknown;
    }>;
  };
  drivers: {
    list(): Array<{ manifest: { id: string } }>;
  };
}

/**
 * 按驱动聚合 registry 贡献：一次 `registry.queryAll()` 枚举全部有效贡献，
 * 按 driverId 预分组；输出按 drivers.list() 顺序每驱动一条（无贡献 → 空数组）。
 * 组内顺序 = queryAll 顺序（注册表遍历序，确定性）。
 */
export function collectCapabilities(kernel: CapabilityKernelLike): DriverCapabilities[] {
  const byDriver = new Map<string, CapabilityContribution[]>();
  for (const c of kernel.registry.queryAll()) {
    let list = byDriver.get(c.driverId);
    if (!list) {
      list = [];
      byDriver.set(c.driverId, list);
    }
    list.push({ type: c.type, id: c.id, origin: c.origin });
  }
  return kernel.drivers.list().map(({ manifest }) => ({
    driverId: manifest.id,
    contributions: byDriver.get(manifest.id) ?? [],
  }));
}
