import { registerStaticContributions, type MinexKernel, type PluginModule } from "@minex/kernel";

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * 逐个注册 + 激活插件（U2：失败回滚静态贡献，与 loader 的 L1 对齐）。
 * 返回 problems 列表，不抛错；isCancelled 用于 StrictMode 双挂载竞态（U4）。
 */
export async function bootPlugins(
  kernel: MinexKernel,
  modules: PluginModule[],
  isCancelled?: () => boolean,
): Promise<string[]> {
  const problems: string[] = [];
  for (const p of modules) {
    if (isCancelled?.()) break;
    try {
      registerStaticContributions(
        {
          register: (m) => kernel.plugins.register(m),
          registerStatic: (type, id, value, pluginId) =>
            kernel.registry.register(type, id, value, { pluginId, origin: "static" }),
          unregisterByPlugin: (pid) => kernel.registry.unregisterByPlugin(pid),
          isRegistered: (pid) => kernel.plugins.getState(pid) !== undefined,
        },
        p.manifest,
      );
      kernel.plugins.register(p);
      await kernel.plugins.activate(p.manifest.id);
    } catch (err) {
      kernel.registry.unregisterByPlugin(p.manifest.id); // 回滚静态贡献
      problems.push(`${p.manifest.id}: ${errMsg(err)}`);
    }
  }
  return problems;
}
