import type { Contribution, QueryFilter } from "./types.js";

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
 */
export interface CapabilityRegistry {
  /** 注册一个能力。同 type+id 冲突时 priority 高者胜；同优先级先到者胜。 */
  register(type: string, id: string, value: unknown, opts?: { pluginId?: string; priority?: number }): void;
  unregister(type: string, id: string): void;
  /** 注销某个插件贡献的全部能力（停用/重载时用） */
  unregisterByPlugin(pluginId: string): void;
  /** 查询某类型的能力列表，按 priority 降序；可用 { plugin } 过滤 */
  query<T = unknown>(type: string, filter?: QueryFilter): Contribution<string, T>[];
  /** 精确取一个能力 */
  get<T = unknown>(type: string, id: string): Contribution<string, T> | undefined;
  /** 订阅某类型的注册/注销事件，返回取消订阅函数 */
  onChange(type: string, cb: (change: RegistryChange) => void): () => void;
}

export function createRegistry(): CapabilityRegistry {
  const store = new Map<string, Map<string, Contribution>>();
  const listeners = new Map<string, Set<(change: RegistryChange) => void>>();

  function bucket(type: string): Map<string, Contribution> {
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
      const existing = store.get(type)?.get(id);
      if (existing) {
        // 高优先级胜；同优先级不同插件 → 先到者胜；同插件重注册 → 更新
        if (priority < existing.priority) return;
        if (priority === existing.priority && existing.pluginId !== pluginId) return;
      }
      bucket(type).set(id, { type, id, value, pluginId, priority });
      fire(type, { type, id, pluginId, action: "registered" });
    },
    unregister(type, id) {
      const existing = store.get(type)?.get(id);
      if (!existing) return;
      bucket(type).delete(id);
      fire(type, { type, id, pluginId: existing.pluginId, action: "unregistered" });
    },
    unregisterByPlugin(pluginId) {
      const fired: RegistryChange[] = [];
      for (const [type, b] of store) {
        for (const [id, c] of [...b]) {
          if (c.pluginId === pluginId) {
            b.delete(id);
            fired.push({ type, id, pluginId, action: "unregistered" });
          }
        }
      }
      for (const change of fired) fire(change.type, change);
    },
    query<T = unknown>(type: string, filter?: QueryFilter): Contribution<string, T>[] {
      const b = store.get(type);
      if (!b) return [];
      let items = [...b.values()];
      if (filter?.plugin) items = items.filter((c) => c.pluginId === filter.plugin);
      return items.sort((x, y) => y.priority - x.priority) as unknown as Contribution<string, T>[];
    },
    get<T = unknown>(type: string, id: string): Contribution<string, T> | undefined {
      return store.get(type)?.get(id) as unknown as Contribution<string, T> | undefined;
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
