/**
 * 消息池（S5e）：任务级共享信息（目标/约束/进度/结论），只存一份。
 * 复用内核 storage（黑板）+ events（失效通知）。manager 独占写；expert 申请→批准→上传。
 */

type Handler = (payload: unknown, topic: string) => void;

/** storage 最小接口（KVNamespace 兼容） */
export interface PoolStore {
  get<T = unknown>(key: string): T | undefined;
  set<T = unknown>(key: string, value: T): void;
}

/** events 最小接口 */
export interface PoolBus {
  emit(topic: string, payload?: unknown): void;
  on(topic: string, handler: Handler): () => void;
}

export interface Pool {
  read(key: string): unknown;
  write(key: string, value: unknown): void;
  onChanged(cb: (key: string) => void): () => void;
}

export const POOL_CHANGED_TOPIC = "pool:changed";
const KEY_PREFIX = "pool:";

/**
 * 创建消息池：key/value 存 storage（agent 命名空间，key 前缀 pool:）；写后 emit `pool:changed`。
 */
export function createPool(storage: PoolStore, bus: PoolBus): Pool {
  return {
    read(key) {
      return storage.get(KEY_PREFIX + key);
    },
    write(key, value) {
      storage.set(KEY_PREFIX + key, value);
      bus.emit(POOL_CHANGED_TOPIC, { key });
    },
    onChanged(cb) {
      return bus.on(POOL_CHANGED_TOPIC, (payload) => cb((payload as { key: string }).key));
    },
  };
}
