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

  /**
   * D2：localStorage key = prefix + name + ":" + encodeURIComponent(key)。
   * name 经 assertName 限制为 A-Za-z0-9_.-（不含 ":"），key 中任何 ":" 都会被编码——
   * 分隔符 ":" 无歧义，namespace 与 key 含点不再串扰。
   */
  function keyOf(name: string, key: string): string {
    return `${prefix}${name}:${encodeURIComponent(key)}`;
  }
  function listPrefix(name: string): string {
    return `${prefix}${name}:`;
  }

  return {
    namespace(name) {
      assertName(name);
      return {
        get<T = unknown>(key: string): T | undefined {
          const raw = ls().getItem(keyOf(name, key));
          if (raw === null) return undefined;
          try {
            return JSON.parse(raw) as T; // D5：损坏值容错，返回 undefined
          } catch {
            return undefined;
          }
        },
        set<T = unknown>(key: string, value: T): void {
          if (value === undefined) {
            ls().removeItem(keyOf(name, key)); // D4：undefined 视为删除，不存 "undefined"
            return;
          }
          ls().setItem(keyOf(name, key), JSON.stringify(value));
        },
        delete(key: string): void {
          ls().removeItem(keyOf(name, key));
        },
        list(): string[] {
          const out: string[] = [];
          const p = listPrefix(name);
          for (let i = 0; i < ls().length; i++) {
            const k = ls().key(i);
            if (k && k.startsWith(p)) {
              const raw = k.slice(p.length);
              try {
                out.push(decodeURIComponent(raw));
              } catch {
                /* 跳过损坏 key */
              }
            }
          }
          return out;
        },
      } satisfies KVNamespace;
    },
  };
}
