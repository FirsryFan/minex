import { MINEX_KERNEL_VERSION } from "./constants.js";
import type { CleanupFn, PluginContext, PluginManifest, PluginModule, PluginState } from "./types.js";
import { compareVersions } from "./version.js";

export interface LifecycleOptions {
  /** 为插件构建 PluginContext；返回 context 与其 dispose（退订等清理） */
  createContext(manifest: PluginManifest): { context: PluginContext; dispose(): void };
  /** 插件被停用 / 激活失败时回调（内核用它清理注册表贡献） */
  onDeactivated?(pluginId: string): void;
}

export interface Lifecycle {
  register(module: PluginModule): void;
  unregister(pluginId: string): void;
  activate(pluginId: string): Promise<void>;
  deactivate(pluginId: string): Promise<void>;
  /** 热重载：停用后重新激活（reloadable:false 的插件拒绝） */
  reload(pluginId: string): Promise<void>;
  getState(pluginId: string): PluginState | undefined;
  list(): PluginModule[];
}

interface Record {
  module: PluginModule;
  state: PluginState;
  cleanup: CleanupFn | null;
  dispose: (() => void) | null;
}

/**
 * 插件状态机：discovered → activated → deactivated | failed。
 * - failed 后副作用已回滚，可重试（activate）或转为 deactivated。
 * - 并发激活用 in-flight Promise 去重；环检测用调用链（chain），二者分离不混淆。
 */
export function createLifecycle(opts: LifecycleOptions): Lifecycle {
  const records = new Map<string, Record>();
  const inFlight = new Map<string, Promise<void>>();

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

  async function doActivate(pluginId: string, chain: Set<string>): Promise<void> {
    if (chain.has(pluginId)) {
      throw new Error(`Circular dependency detected at plugin "${pluginId}"`);
    }
    const nextChain = new Set(chain).add(pluginId);
    const r = getRecord(pluginId);
    if (r.state === "activated") return;
    if (r.state === "deactivated") {
      throw new Error(`Plugin "${pluginId}" is deactivated; use reload to reactivate`);
    }
    // discovered / loaded / failed 均可执行激活（failed = 重试）

    const depsActivated: string[] = []; // 本次调用新激活的依赖（失败时逆序回滚）
    try {
      for (const dep of r.module.manifest.dependencies ?? []) {
        const d = records.get(dep);
        if (!d) throw new Error(`Plugin "${pluginId}" depends on missing plugin "${dep}"`);
        const before = d.state;
        await activateViaChain(dep, nextChain); // 链感知：环检测 + 并发去重
        if (before !== "activated") depsActivated.push(dep);
      }

      const { context, dispose } = opts.createContext(r.module.manifest);
      r.dispose = dispose; // 先存再跑 activate：失败时 catch 才能拿到引用回滚订阅
      const result = await r.module.activate(context);
      r.cleanup = typeof result === "function" ? result : null;
      r.state = "activated";
    } catch (err) {
      // 回滚：逆序停用本次新激活的依赖（全激活或全不激活）
      for (const dep of depsActivated.reverse()) {
        try {
          await deactivate(dep);
        } catch {
          /* 回滚失败不阻断主错误 */
        }
      }
      // 清理本插件已产生的副作用：订阅（dispose）+ 注册贡献（onDeactivated）
      r.dispose?.();
      r.dispose = null;
      r.cleanup = null;
      opts.onDeactivated?.(pluginId);
      r.state = "failed";
      throw err;
    }
  }

  /**
   * 链感知激活：
   * - 已在激活中：当前链含该插件 → 环；否则 → 复用 in-flight Promise（并发去重）
   * - 未在激活中：启动 doActivate，把当前链传下去（环检测不因递归丢失）
   */
  async function activateViaChain(pluginId: string, chain: Set<string>): Promise<void> {
    const existing = inFlight.get(pluginId);
    if (existing) {
      if (chain.has(pluginId)) {
        throw new Error(`Circular dependency detected at plugin "${pluginId}"`);
      }
      return existing;
    }
    const p = doActivate(pluginId, chain).finally(() => inFlight.delete(pluginId));
    inFlight.set(pluginId, p);
    return p;
  }

  function activate(pluginId: string): Promise<void> {
    return activateViaChain(pluginId, new Set());
  }

  async function deactivate(pluginId: string): Promise<void> {
    const r = getRecord(pluginId);
    if (r.state === "activated") {
      try {
        if (r.cleanup) await r.cleanup();
      } finally {
        r.cleanup = null;
        r.dispose?.();
        r.dispose = null;
        opts.onDeactivated?.(pluginId);
        r.state = "deactivated";
      }
    } else if (r.state === "failed") {
      // 失败态副作用已在失败时清理，直接转为停用
      r.state = "deactivated";
    }
    // 其他状态：无操作
  }

  async function reload(pluginId: string): Promise<void> {
    const r = getRecord(pluginId);
    if (r.module.manifest.reloadable === false) {
      throw new Error(`Plugin "${pluginId}" is not reloadable`);
    }
    if (r.state === "activated") await deactivate(pluginId);
    r.state = "discovered"; // 重置为可激活，允许重新激活
    await activate(pluginId);
  }

  return {
    register(module) {
      checkVersion(module.manifest);
      if (records.has(module.manifest.id)) {
        throw new Error(`Plugin already registered: ${module.manifest.id}`);
      }
      records.set(module.manifest.id, { module, state: "discovered", cleanup: null, dispose: null });
    },
    unregister(pluginId) {
      const r = getRecord(pluginId);
      if (inFlight.has(pluginId)) {
        throw new Error(`Cannot unregister "${pluginId}" while it is activating`);
      }
      if (r.state === "activated") {
        throw new Error(`Cannot unregister "${pluginId}" while activated; deactivate first`);
      }
      opts.onDeactivated?.(pluginId); // 防御：清理可能残留的贡献
      records.delete(pluginId);
    },
    activate,
    deactivate,
    reload,
    getState(pluginId) {
      return records.get(pluginId)?.state;
    },
    list() {
      return [...records.values()].map((r) => r.module);
    },
  };
}
