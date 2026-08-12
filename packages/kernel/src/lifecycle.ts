import { MINEX_KERNEL_VERSION } from "./constants.js";
import type { CleanupFn, DriverContext, DriverManifest, DriverModule, DriverState } from "./types.js";
import { compareVersions } from "./version.js";

export interface LifecycleOptions {
  /** 为驱动构建 DriverContext；返回 context 与其 dispose（退订等清理） */
  createContext(manifest: DriverManifest): { context: DriverContext; dispose(): void };
  /** 驱动被停用 / 激活失败时回调（内核用它清理该驱动的运行时贡献；静态贡献保留） */
  onDeactivated?(driverId: string): void;
  /** 驱动被卸载（unregister）时回调（内核用它清理全部贡献，含静态） */
  onUnregistered?(driverId: string): void;
}

export interface Lifecycle {
  register(module: DriverModule): void;
  unregister(driverId: string): void;
  activate(driverId: string): Promise<void>;
  deactivate(driverId: string): Promise<void>;
  /** 热重载：停用后重新激活（reloadable:false 的驱动拒绝） */
  reload(driverId: string): Promise<void>;
  getState(driverId: string): DriverState | undefined;
  list(): DriverModule[];
}

interface Record {
  module: DriverModule;
  state: DriverState;
  cleanup: CleanupFn | null;
  dispose: (() => void) | null;
}

/**
 * 驱动状态机：discovered → activated → deactivated | failed。
 * - failed 后副作用已回滚，可重试（activate）或转为 deactivated。
 * - 并发激活用 in-flight Promise 去重；环检测用调用链（chain）。
 * - 失败回滚用「激活 session」：整棵激活树新激活的驱动全部逆序回滚（深层依赖不残留）。
 */
export function createLifecycle(opts: LifecycleOptions): Lifecycle {
  const records = new Map<string, Record>();
  const inFlight = new Map<string, Promise<void>>();

  function getRecord(driverId: string): Record {
    const r = records.get(driverId);
    if (!r) throw new Error(`Unknown driver: ${driverId}`);
    return r;
  }

  function checkVersion(manifest: DriverManifest): void {
    if (
      manifest.minKernelVersion &&
      compareVersions(manifest.minKernelVersion, MINEX_KERNEL_VERSION) > 0
    ) {
      throw new Error(
        `Driver "${manifest.id}" requires kernel >= ${manifest.minKernelVersion}, but kernel is ${MINEX_KERNEL_VERSION}`,
      );
    }
  }

  /** 回滚一个激活 session：逆序停用本次树新激活的全部驱动 */
  async function rollbackSession(session: Set<string>, except: string): Promise<void> {
    for (const pid of [...session].reverse()) {
      if (pid === except) continue;
      try {
        await deactivate(pid);
      } catch {
        /* 回滚失败不阻断主错误 */
      }
    }
  }

  async function doActivate(driverId: string, chain: Set<string>, session: Set<string>): Promise<void> {
    if (chain.has(driverId)) {
      throw new Error(`Circular dependency detected at driver "${driverId}"`);
    }
    const nextChain = new Set(chain).add(driverId);
    const r = getRecord(driverId);
    if (r.state === "activated") return;
    if (r.state === "deactivated") {
      throw new Error(`Driver "${driverId}" is deactivated; use reload to reactivate`);
    }
    // discovered / loaded / failed 均可执行激活（failed = 重试）

    try {
      for (const dep of r.module.manifest.dependencies ?? []) {
        const d = records.get(dep);
        if (!d) throw new Error(`Driver "${driverId}" depends on missing driver "${dep}"`);
        await activateViaChain(dep, nextChain, session); // 链感知：环检测 + 并发去重
      }

      const { context, dispose } = opts.createContext(r.module.manifest);
      r.dispose = dispose; // 先存再跑 activate：失败时 catch 才能拿到引用回滚订阅
      const result = await r.module.activate(context);
      r.cleanup = typeof result === "function" ? result : null;
      r.state = "activated";
      session.add(driverId); // 只记录真正激活成功的，供失败时回滚
    } catch (err) {
      await rollbackSession(session, driverId); // 深层依赖一起逆序回滚
      r.dispose?.();
      r.dispose = null;
      r.cleanup = null;
      opts.onDeactivated?.(driverId);
      r.state = "failed";
      throw err;
    }
  }

  /**
   * 链感知激活：
   * - 已在激活中：当前链含该驱动 → 环；否则 → 复用 in-flight Promise（并发去重）
   * - 未在激活中：启动 doActivate，把当前链与激活 session 传下去
   */
  async function activateViaChain(driverId: string, chain: Set<string>, session: Set<string>): Promise<void> {
    const existing = inFlight.get(driverId);
    if (existing) {
      if (chain.has(driverId)) {
        throw new Error(`Circular dependency detected at driver "${driverId}"`);
      }
      return existing;
    }
    const p = doActivate(driverId, chain, session).finally(() => inFlight.delete(driverId));
    inFlight.set(driverId, p);
    return p;
  }

  function activate(driverId: string): Promise<void> {
    return activateViaChain(driverId, new Set(), new Set());
  }

  async function deactivate(driverId: string): Promise<void> {
    const r = getRecord(driverId);
    if (r.state === "activated") {
      try {
        if (r.cleanup) await r.cleanup();
      } finally {
        r.cleanup = null;
        r.dispose?.();
        r.dispose = null;
        opts.onDeactivated?.(driverId);
        r.state = "deactivated";
      }
    } else if (r.state === "failed") {
      // 失败态副作用已在失败时清理，直接转为停用
      r.state = "deactivated";
    }
    // 其他状态：无操作
  }

  async function reload(driverId: string): Promise<void> {
    const r = getRecord(driverId);
    if (r.module.manifest.reloadable === false) {
      throw new Error(`Driver "${driverId}" is not reloadable`);
    }
    if (r.state === "activated") await deactivate(driverId);
    r.state = "discovered"; // 重置为可激活，允许重新激活
    await activate(driverId);
  }

  return {
    register(module) {
      checkVersion(module.manifest);
      if (records.has(module.manifest.id)) {
        throw new Error(`Driver already registered: ${module.manifest.id}`);
      }
      records.set(module.manifest.id, { module, state: "discovered", cleanup: null, dispose: null });
    },
    unregister(driverId) {
      const r = getRecord(driverId);
      if (inFlight.has(driverId)) {
        throw new Error(`Cannot unregister "${driverId}" while it is activating`);
      }
      if (r.state === "activated") {
        throw new Error(`Cannot unregister "${driverId}" while activated; deactivate first`);
      }
      opts.onUnregistered?.(driverId); // 全量清理（含静态贡献）
      records.delete(driverId);
    },
    activate,
    deactivate,
    reload,
    getState(driverId) {
      return records.get(driverId)?.state;
    },
    list() {
      return [...records.values()].map((r) => r.module);
    },
  };
}
