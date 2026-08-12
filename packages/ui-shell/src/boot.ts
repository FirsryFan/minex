import { registerStaticContributions, type MinexKernel, type DriverModule } from "@minex/kernel";

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * 逐个注册 + 激活驱动（U2：失败回滚静态贡献，与 loader 的 L1 对齐）。
 * 返回 problems 列表，不抛错；isCancelled 用于 StrictMode 双挂载竞态（U4）。
 */
export async function bootDrivers(
  kernel: MinexKernel,
  modules: DriverModule[],
  isCancelled?: () => boolean,
): Promise<string[]> {
  const problems: string[] = [];
  for (const p of modules) {
    if (isCancelled?.()) break;
    try {
      registerStaticContributions(
        {
          register: (m) => kernel.drivers.register(m),
          registerStatic: (type, id, value, driverId) =>
            kernel.registry.register(type, id, value, { driverId, origin: "static" }),
          unregisterByDriver: (pid) => kernel.registry.unregisterByDriver(pid),
          isRegistered: (pid) => kernel.drivers.getState(pid) !== undefined,
        },
        p.manifest,
      );
      kernel.drivers.register(p);
      await kernel.drivers.activate(p.manifest.id);
    } catch (err) {
      kernel.registry.unregisterByDriver(p.manifest.id); // 回滚静态贡献
      problems.push(`${p.manifest.id}: ${errMsg(err)}`);
    }
  }
  return problems;
}
