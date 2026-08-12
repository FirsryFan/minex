import { MINEX_KERNEL_VERSION } from "./constants.js";
import type { CleanupFn, PluginContext, PluginManifest, PluginModule, PluginState } from "./types.js";
import { compareVersions } from "./version.js";

export interface LifecycleOptions {
  /** 为插件构建 PluginContext */
  createContext(manifest: PluginManifest): PluginContext;
  /** 插件被停用时回调（内核用它清理该插件的注册表贡献） */
  onDeactivated?(pluginId: string): void;
}

export interface Lifecycle {
  register(module: PluginModule): void;
  unregister(pluginId: string): void;
  activate(pluginId: string): Promise<void>;
  deactivate(pluginId: string): Promise<void>;
  getState(pluginId: string): PluginState | undefined;
  list(): PluginModule[];
}

interface Record {
  module: PluginModule;
  state: PluginState;
  cleanup: CleanupFn | null;
}

/** 插件状态机：discovered → activated → deactivated（loaded 留给阶段 2 的文件加载） */
export function createLifecycle(opts: LifecycleOptions): Lifecycle {
  const records = new Map<string, Record>();
  const activating = new Set<string>();

  function getRecord(pluginId: string): Record {
    const r = records.get(pluginId);
    if (!r) throw new Error(`Unknown plugin: ${pluginId}`);
    return r;
  }

  function checkVersion(manifest: PluginManifest): void {
    if (
      manifest.minKernelVersion &&
      compareVersions(manifest.minKernelVersion, MINEX_KERNEL_VERSION) > 0
    ) {
      throw new Error(
        `Plugin "${manifest.id}" requires kernel >= ${manifest.minKernelVersion}, but kernel is ${MINEX_KERNEL_VERSION}`,
      );
    }
  }

  async function activate(pluginId: string): Promise<void> {
    const r = getRecord(pluginId);
    if (r.state === "activated") return;
    if (r.state === "deactivated") {
      throw new Error(`Plugin "${pluginId}" is deactivated; register it again to reload`);
    }
    if (activating.has(pluginId)) {
      throw new Error(`Circular dependency detected at plugin "${pluginId}"`);
    }
    activating.add(pluginId);
    try {
      // 依赖先激活
      for (const dep of r.module.manifest.dependencies ?? []) {
        const d = records.get(dep);
        if (!d) throw new Error(`Plugin "${pluginId}" depends on missing plugin "${dep}"`);
        await activate(dep);
      }
      const ctx = opts.createContext(r.module.manifest);
      const result = await r.module.activate(ctx);
      r.cleanup = typeof result === "function" ? result : null;
      r.state = "activated";
    } finally {
      activating.delete(pluginId);
    }
  }

  async function deactivate(pluginId: string): Promise<void> {
    const r = getRecord(pluginId);
    if (r.state !== "activated") return;
    if (r.cleanup) await r.cleanup();
    r.cleanup = null;
    r.state = "deactivated";
    opts.onDeactivated?.(pluginId);
  }

  return {
    register(module) {
      checkVersion(module.manifest);
      if (records.has(module.manifest.id)) {
        throw new Error(`Plugin already registered: ${module.manifest.id}`);
      }
      records.set(module.manifest.id, { module, state: "discovered", cleanup: null });
    },
    unregister(pluginId) {
      const r = getRecord(pluginId);
      if (r.state !== "discovered") {
        throw new Error(`Cannot unregister "${pluginId}" while state is ${r.state}`);
      }
      records.delete(pluginId);
    },
    activate,
    deactivate,
    getState(pluginId) {
      return records.get(pluginId)?.state;
    },
    list() {
      return [...records.values()].map((r) => r.module);
    },
  };
}
