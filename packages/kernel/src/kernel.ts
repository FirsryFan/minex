import { createEventBus, type EventBus } from "./events.js";
import { createLifecycle, type Lifecycle } from "./lifecycle.js";
import { createRegistry, type CapabilityRegistry } from "./registry.js";
import { createInMemoryStorage, createJsonFileStorage } from "./storage.js";
import type { Logger, PluginContext, PluginManifest, PluginModule, PluginState, QueryFilter, StorageProvider } from "./types.js";

export interface KernelOptions {
  /** 存储提供者；默认 JSON 文件存储 */
  storage?: StorageProvider;
  /** JSON 文件存储的目录（未传 storage 时生效） */
  storageDir?: string;
  log?: Logger;
}

export interface MinexKernel {
  readonly registry: CapabilityRegistry;
  readonly events: EventBus;
  readonly storage: StorageProvider;
  readonly plugins: {
    register(module: PluginModule): void;
    activate(pluginId: string): Promise<void>;
    deactivate(pluginId: string): Promise<void>;
    reload(pluginId: string): Promise<void>;
    getState(pluginId: string): PluginState | undefined;
    list(): PluginModule[];
  };
  /** 停用所有激活的插件 */
  destroy(): Promise<void>;
}

const consoleLogger: Logger = {
  info: (msg, ...args) => console.log(`[minex] ${msg}`, ...args),
  warn: (msg, ...args) => console.warn(`[minex] ${msg}`, ...args),
  error: (msg, ...args) => console.error(`[minex] ${msg}`, ...args),
};

function pluginLogger(base: Logger, pluginId: string): Logger {
  return {
    info: (msg, ...args) => base.info(`[${pluginId}] ${msg}`, ...args),
    warn: (msg, ...args) => base.warn(`[${pluginId}] ${msg}`, ...args),
    error: (msg, ...args) => base.error(`[${pluginId}] ${msg}`, ...args),
  };
}

/** 组装内核：注册表 + 事件 + 存储 + 生命周期，暴露「插件视图」(PluginContext) 与「宿主视图」(kernel) */
export function createKernel(opts: KernelOptions = {}): MinexKernel {
  const storage = opts.storage ?? createJsonFileStorage(opts.storageDir ?? ".minex-data");
  const registry = createRegistry();
  const events = createEventBus();
  const log = opts.log ?? consoleLogger;

  function createContext(manifest: PluginManifest): { context: PluginContext; dispose(): void } {
    const subscriptions: Array<() => void> = [];
    const context: PluginContext = {
      manifest,
      register(type: string, id: string, value: unknown, o?: { priority?: number }): void {
        registry.register(type, id, value, { pluginId: manifest.id, priority: o?.priority ?? 0 });
      },
      unregister(type: string, id: string): void {
        registry.unregister(type, id);
      },
      query<T = unknown>(type: string, filter?: QueryFilter): T[] {
        return registry.query<T>(type, filter).map((c) => c.value as T);
      },
      get<T = unknown>(type: string, id: string): T | undefined {
        return registry.get<T>(type, id)?.value;
      },
      on(topic: string, handler: (payload: unknown, topic: string) => void): () => void {
        const off = events.on(topic, handler);
        subscriptions.push(off); // 内核代管订阅：停用/失败时统一退订
        return off;
      },
      emit(topic: string, payload?: unknown): void {
        events.emit(topic, payload);
      },
      storage: storage.namespace(manifest.id),
      log: pluginLogger(log, manifest.id),
    };
    return {
      context,
      dispose() {
        for (const off of subscriptions) off();
        subscriptions.length = 0;
      },
    };
  }

  const lifecycle = createLifecycle({
    createContext,
    onDeactivated(pluginId) {
      registry.unregisterByPlugin(pluginId);
    },
  });

  return {
    registry,
    events,
    storage,
    plugins: {
      register: (module) => lifecycle.register(module),
      activate: (id) => lifecycle.activate(id),
      deactivate: (id) => lifecycle.deactivate(id),
      reload: (id) => lifecycle.reload(id),
      getState: (id) => lifecycle.getState(id),
      list: () => lifecycle.list(),
    },
    async destroy() {
      for (const module of lifecycle.list()) {
        if (lifecycle.getState(module.manifest.id) !== "activated") continue;
        try {
          await lifecycle.deactivate(module.manifest.id);
        } catch (err) {
          log.warn(`Failed to deactivate plugin "${module.manifest.id}":`, err); // 一个失败不跳过其余
        }
      }
    },
  };
}
