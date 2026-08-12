import { createInMemoryStorage, createKernel, registerStaticContributions, type MinexKernel } from "@minex/kernel";
import { useEffect, useState } from "react";
import { App } from "./App.js";
import { KernelContext } from "./kernel-context.js";
import { PLUGINS } from "./plugins.js";

interface BootState {
  kernel?: MinexKernel;
  problems: string[];
}

/** 启动：建内核（内存存储）→ 注册静态贡献 → 注册插件 → 逐个激活（容错，C1 语义）→ 渲染 */
export function Bootstrap() {
  const [state, setState] = useState<BootState>({ problems: [] });

  useEffect(() => {
    const kernel = createKernel({ storage: createInMemoryStorage() });
    const problems: string[] = [];
    let cancelled = false;

    (async () => {
      for (const p of PLUGINS) {
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
          problems.push(`${p.manifest.id}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      if (!cancelled) setState({ kernel, problems });
    })();

    return () => {
      cancelled = true;
      void kernel.destroy();
    };
  }, []);

  if (!state.kernel) {
    return <div className="loading">Minex 启动中…</div>;
  }
  return (
    <KernelContext.Provider value={state.kernel}>
      <App problems={state.problems} />
    </KernelContext.Provider>
  );
}
