import { createKernel, type MinexKernel } from "@minex/kernel";
import { useEffect, useState } from "react";
import { App } from "./App.js";
import { bootDrivers } from "./boot.js";
import { KernelContext } from "./kernel-context.js";
import { DRIVERS } from "./drivers.js";
import { createLocalStorageStorage } from "./storage-local.js";

interface BootState {
  kernel?: MinexKernel;
  problems: string[];
}

/** 启动：建内核（localStorage 持久化）→ 注册+激活（容错回滚）→ 渲染 */
export function Bootstrap() {
  const [state, setState] = useState<BootState>({ problems: [] });

  useEffect(() => {
    const kernel = createKernel({ storage: createLocalStorageStorage() });
    let cancelled = false;

    (async () => {
      const problems = await bootDrivers(kernel, DRIVERS, () => cancelled);
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
