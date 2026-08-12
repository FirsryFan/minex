import type { KVNamespace, StorageProvider } from "@minex/kernel";

const NAME_RE = /^[A-Za-z0-9_.-]+$/;

/**
 * 浏览器 localStorage 存储适配器（U1：让设置跨页面刷新持久）。
 * namespace → localStorage 前缀键。localStorage 只在调用时读取（Node 下 safe）。
 */
export function createLocalStorageStorage(prefix = "minex:"): StorageProvider {
  function ls(): Storage {
    const store = (globalThis as { localStorage?: Storage }).localStorage;
    if (!store) throw new Error("localStorage 不可用——需在浏览器环境使用");
    return store;
  }

  function assertName(name: string): void {
    if (!NAME_RE.test(name)) {
      throw new Error(`Storage: invalid namespace name "${name}" (allowed: A-Za-z0-9_.-)`);
    }
  }

  function keyOf(name: string, key: string): string {
    return `${prefix}${name}.${key}`;
  }

  return {
    namespace(name) {
      assertName(name);
      return {
        get<T = unknown>(key: string): T | undefined {
          const raw = ls().getItem(keyOf(name, key));
          return raw === null ? undefined : (JSON.parse(raw) as T);
        },
        set<T = unknown>(key: string, value: T): void {
          ls().setItem(keyOf(name, key), JSON.stringify(value));
        },
        delete(key: string): void {
          ls().removeItem(keyOf(name, key));
        },
        list(): string[] {
          const out: string[] = [];
          const p = `${prefix}${name}.`;
          for (let i = 0; i < ls().length; i++) {
            const k = ls().key(i);
            if (k && k.startsWith(p)) out.push(k.slice(p.length));
          }
          return out;
        },
      } satisfies KVNamespace;
    },
  };
}
