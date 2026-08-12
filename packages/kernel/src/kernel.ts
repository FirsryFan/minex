import { createEventBus, type EventBus } from "./events.js";
import { createLifecycle, type Lifecycle } from "./lifecycle.js";
import { loadDriversFromDir, type LoadResult } from "./loader.js";
import { createRegistry, type CapabilityRegistry } from "./registry.js";
import { createInMemoryStorage, createJsonFileStorage } from "./storage.js";
import type { Logger, DriverContext, DriverManifest, DriverModule, DriverState, QueryFilter, StorageProvider } from "./types.js";

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
  readonly drivers: {
    register(module: DriverModule): void;
    /** 从目录发现并注册驱动（静态贡献自动注册；不自动激活） */
    loadFromDir(dir: string): Promise<LoadResult>;
    activate(driverId: string): Promise<void>;
    deactivate(driverId: string): Promise<void>;
    reload(driverId: string): Promise<void>;
    getState(driverId: string): DriverState | undefined;
    list(): DriverModule[];
  };
  /** 停用所有激活的驱动 */
  destroy(): Promise<void>;
}

const consoleLogger: Logger = {
  info: (msg, ...args) => console.log(`[minex] ${msg}`, ...args),
  warn: (msg, ...args) => console.warn(`[minex] ${msg}`, ...args),
  error: (msg, ...args) => console.error(`[minex] ${msg}`, ...args),
};

function driverLogger(base: Logger, driverId: string): Logger {
  return {
    info: (msg, ...args) => base.info(`[${driverId}] ${msg}`, ...args),
    warn: (msg, ...args) => base.warn(`[${driverId}] ${msg}`, ...args),
    error: (msg, ...args) => base.error(`[${driverId}] ${msg}`, ...args),
  };
}

/** 组装内核：注册表 + 事件 + 存储 + 生命周期，暴露「驱动视图」(DriverContext) 与「宿主视图」(kernel) */
export function createKernel(opts: KernelOptions = {}): MinexKernel {
  const storage = opts.storage ?? createJsonFileStorage(opts.storageDir ?? ".minex-data");
  const registry = createRegistry();
  const events = createEventBus();
  const log = opts.log ?? consoleLogger;

  function createContext(manifest: DriverManifest): { context: DriverContext; dispose(): void } {
    const subscriptions: Array<() => void> = [];
    const context: DriverContext = {
      manifest,
      register(type: string, id: string, value: unknown, o?: { priority?: number }): void {
        registry.register(type, id, value, { driverId: manifest.id, priority: o?.priority ?? 0 });
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
      log: driverLogger(log, manifest.id),
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
    // 停用/失败：只清运行时贡献，静态贡献（manifest 声明）随驱动注册存活
    onDeactivated(driverId) {
      registry.unregisterByDriver(driverId, "runtime");
    },
    // 驱动被卸载（unregister）：静态 + 运行时全清
    onUnregistered(driverId) {
      registry.unregisterByDriver(driverId);
    },
  });

  return {
    registry,
    events,
    storage,
    drivers: {
      register: (module) => lifecycle.register(module),
      loadFromDir: (dir) =>
        loadDriversFromDir(dir, {
          register: (module) => lifecycle.register(module),
          registerStatic: (type, id, value, driverId) =>
            registry.register(type, id, value, { driverId, origin: "static" }),
          unregisterByDriver: (driverId) => registry.unregisterByDriver(driverId),
          isRegistered: (driverId) => lifecycle.getState(driverId) !== undefined,
        }),
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
          log.warn(`Failed to deactivate driver "${module.manifest.id}":`, err); // 一个失败不跳过其余
        }
      }
    },
  };
}
