/**
 * 驱动能力总览数据管道（阶段 A1）：按驱动聚合 registry 贡献的纯函数。
 *
 * 消费的是贡献元数据（type/id/origin）——这里要的就是贡献清单本身，
 * 与「取能力值才 .map(c => c.value)」的宿主视图纪律不冲突（见任务 A1 语义）。
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

/**
 * 外壳已知的贡献 type 目录（现有驱动注册的 type 全集，见各驱动 index.ts）：
 * panel / theme / settingsView / filesystem / markdown / appearance.driverSetting。
 * registry 无法枚举 type（只能按 type 查询），故目录由外壳声明；新增贡献 type 时在此追加。
 */
export const KNOWN_CAPABILITY_TYPES = [
  "panel",
  "theme",
  "settingsView",
  "filesystem",
  "markdown",
  "appearance.driverSetting",
] as const;

/** kernel 最小结构（结构类型：registry 宿主视图 + 已加载驱动清单） */
export interface CapabilityKernelLike {
  registry: {
    query<T = unknown>(
      type: string,
      filter?: { driver?: string },
    ): Array<{
      type: string;
      id: string;
      driverId: string;
      origin: CapabilityOrigin;
      value: T;
    }>;
  };
  drivers: {
    list(): Array<{ manifest: { id: string } }>;
  };
}

/**
 * 按驱动聚合 registry 贡献：对每个已加载驱动（drivers.list()），
 * 依 type 目录逐类查询 `registry.query(type, { driver })`，收集贡献元数据。
 * 无贡献的驱动 → 空数组。输出顺序 = drivers.list() 顺序；组内 = 目录序 × 查询序（priority 降序）。
 */
export function collectCapabilities(
  kernel: CapabilityKernelLike,
  types: readonly string[] = KNOWN_CAPABILITY_TYPES,
): DriverCapabilities[] {
  return kernel.drivers.list().map(({ manifest }) => {
    const contributions: CapabilityContribution[] = [];
    for (const type of types) {
      for (const c of kernel.registry.query<unknown>(type, { driver: manifest.id })) {
        contributions.push({ type: c.type, id: c.id, origin: c.origin });
      }
    }
    return { driverId: manifest.id, contributions };
  });
}
