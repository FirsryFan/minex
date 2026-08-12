import type { Contribution, ContributionOrigin, QueryFilter } from "./types.js";

/** 注册表变更事件（onChange 通知） */
export type RegistryChange = {
  type: string;
  id: string;
  pluginId: string;
  action: "registered" | "unregistered";
};

/**
 * 能力注册表 —— 内核的核心原语。
 * 内核只管理「按 type 注册 + 按 type 查询」，不认识任何 type 的语义。
 *
 * 分层模型：每个 (type, id) 可有 static 与 runtime 两层。
 * - static：manifest 声明，随插件注册存活（激活前可见、停用/reload 不消失）
 * - runtime：activate 注册，随停用/失败清除
 * - 有效值（effective）= runtime ?? static：激活时运行时贡献「阴影」静态声明；
 *   停用后揭掉阴影，露出静态层（如命令的 label 存活、handler 随停用消失）
 * - 注意（U5）：跨层优先级不可比——runtime 层总是遮蔽 static 层（与 priority 无关）。
 *   多插件在同一 (type,id) 的 static 与 runtime 分属不同插件时，runtime 胜。
 */
export interface CapabilityRegistry {
  /**
   * 注册一个能力（写入对应 origin 层）。层内冲突语义：priority 高者胜；
   * 同优先级不同插件先到者胜；同插件重注册 = 更新（允许任意优先级，含降级）。
   */
  register(
    type: string,
    id: string,
    value: unknown,
    opts?: { pluginId?: string; priority?: number; origin?: ContributionOrigin },
  ): void;
  unregister(type: string, id: string): void;
  /** 注销某插件某层贡献。origin 省略 = 清两层；指定则只清该层（停用只清 runtime，静态保留） */
  unregisterByPlugin(pluginId: string, origin?: ContributionOrigin): void;
  /** 查询某类型的能力列表（有效值 = runtime ?? static），按 priority 降序；可用 { plugin } 过滤 */
  query<T = unknown>(type: string, filter?: QueryFilter): Contribution<string, T>[];
  /** 精确取一个能力的有效值 */
  get<T = unknown>(type: string, id: string): Contribution<string, T> | undefined;
  /** 订阅某类型的注册/注销事件，返回取消订阅函数 */
  onChange(type: string, cb: (change: RegistryChange) => void): () => void;
}

interface LayerEntry {
  static?: Contribution;
  runtime?: Contribution;
}

function effective(entry: LayerEntry | undefined): Contribution | undefined {
  return entry?.runtime ?? entry?.static;
}

export function createRegistry(): CapabilityRegistry {
  const store = new Map<string, Map<string, LayerEntry>>();
  const listeners = new Map<string, Set<(change: RegistryChange) => void>>();

  function bucket(type: string): Map<string, LayerEntry> {
    let b = store.get(type);
    if (!b) {
      b = new Map();
      store.set(type, b);
    }
    return b;
  }

  function fire(type: string, change: RegistryChange): void {
    const set = listeners.get(type);
    if (set) for (const cb of [...set]) safeCall(cb, change);
    const all = listeners.get("*");
    if (all) for (const cb of [...all]) safeCall(cb, change);
  }

  function safeCall(cb: (change: RegistryChange) => void, change: RegistryChange): void {
    try {
      cb(change);
    } catch (err) {
      console.error(`[registry] onChange handler threw:`, err); // 一个坏监听不阻断其余分发
    }
  }

  return {
    register(type, id, value, opts = {}) {
      if (!type || !id) throw new Error(`registry: type and id must be non-empty (got type="${type}", id="${id}")`);
      const pluginId = opts.pluginId ?? "kernel";
      const raw = opts.priority ?? 0;
      const priority = Number.isFinite(raw) ? raw : 0; // NaN/Infinity 防呆
      const origin: ContributionOrigin = opts.origin ?? "runtime";
      const b = bucket(type);
      const entry = b.get(id) ?? {};
      const existing = entry[origin];
      if (existing) {
        const samePlugin = existing.pluginId === pluginId;
        // 不同插件：高优先级胜 / 同优先级先到者胜；同插件：任意优先级都允许更新（含降级）
        if (!samePlugin && priority < existing.priority) return;
        if (!samePlugin && priority === existing.priority) return;
      }
      entry[origin] = { type, id, value, pluginId, priority, origin };
      b.set(id, entry);
      fire(type, { type, id, pluginId, action: "registered" });
    },
    // U6：unregister 只移除 runtime 层（活动贡献），静态声明保留到插件卸载。
    unregister(type, id) {
      const entry = store.get(type)?.get(id);
      if (!entry) return;
      const removed = entry.runtime;
      delete entry.runtime;
      if (!entry.static && !entry.runtime) bucket(type).delete(id);
      if (removed) fire(type, { type, id, pluginId: removed.pluginId, action: "unregistered" });
    },
    unregisterByPlugin(pluginId, origin) {
      const fired: RegistryChange[] = [];
      for (const [type, b] of store) {
        for (const [id, entry] of [...b]) {
          if (origin === undefined) {
            const hadStatic = entry.static?.pluginId === pluginId;
            const hadRuntime = entry.runtime?.pluginId === pluginId;
            if (hadStatic) delete entry.static;
            if (hadRuntime) delete entry.runtime;
            if (hadStatic || hadRuntime) fired.push({ type, id, pluginId, action: "unregistered" });
          } else {
            const layer = entry[origin];
            if (layer?.pluginId === pluginId) {
              delete entry[origin];
              fired.push({ type, id, pluginId, action: "unregistered" });
            }
          }
          if (!entry.static && !entry.runtime) b.delete(id);
        }
      }
      for (const change of fired) fire(change.type, change);
    },
    query<T = unknown>(type: string, filter?: QueryFilter): Contribution<string, T>[] {
      const b = store.get(type);
      if (!b) return [];
      let items: Contribution[] = [];
      for (const entry of b.values()) {
        const eff = effective(entry);
        if (eff) items.push(eff);
      }
      if (filter?.plugin) items = items.filter((c) => c.pluginId === filter.plugin);
      return items.sort((x, y) => y.priority - x.priority) as unknown as Contribution<string, T>[];
    },
    get<T = unknown>(type: string, id: string): Contribution<string, T> | undefined {
      return effective(store.get(type)?.get(id)) as unknown as Contribution<string, T> | undefined;
    },
    onChange(type, cb) {
      let set = listeners.get(type);
      if (!set) {
        set = new Set();
        listeners.set(type, set);
      }
      set.add(cb);
      return () => set!.delete(cb);
    },
  };
}
