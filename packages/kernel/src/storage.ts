import * as fs from "node:fs";
import * as path from "node:path";
import type { KVNamespace, StorageProvider } from "./types.js";

/** 内存存储（测试 / 无持久化场景用） */
export function createInMemoryStorage(): StorageProvider {
  const namespaces = new Map<string, Map<string, unknown>>();
  return {
    namespace(name) {
      let ns = namespaces.get(name);
      if (!ns) {
        ns = new Map();
        namespaces.set(name, ns);
      }
      return {
        get<T = unknown>(key: string): T | undefined {
          return ns!.get(key) as unknown as T;
        },
        set<T = unknown>(key: string, value: T): void {
          ns!.set(key, value as unknown);
        },
        delete(key: string): void {
          ns!.delete(key);
        },
        list(): string[] {
          return [...ns!.keys()];
        },
      };
    },
  };
}

/**
 * JSON 文件存储：每个命名空间一个 JSON 文件。
 * 存储是接口（StorageProvider），实现可替换——这是内核唯一的 Node 绑定点。
 */
export function createJsonFileStorage(baseDir: string): StorageProvider {
  fs.mkdirSync(baseDir, { recursive: true });
  const cache = new Map<string, Map<string, unknown>>();

  function fileOf(name: string): string {
    const safe = name.replace(/[^A-Za-z0-9_.-]/g, "_");
    return path.join(baseDir, `${safe}.json`);
  }

  function load(name: string): Map<string, unknown> {
    let ns = cache.get(name);
    if (ns) return ns;
    ns = new Map();
    try {
      const raw = fs.readFileSync(fileOf(name), "utf8");
      const data = JSON.parse(raw) as Record<string, unknown>;
      for (const [k, v] of Object.entries(data)) ns.set(k, v);
    } catch {
      // 文件不存在或损坏 → 视为空
    }
    cache.set(name, ns);
    return ns;
  }

  function persist(name: string, ns: Map<string, unknown>): void {
    const obj: Record<string, unknown> = {};
    for (const [k, v] of ns) obj[k] = v;
    fs.writeFileSync(fileOf(name), JSON.stringify(obj, null, 2), "utf8");
  }

  return {
    namespace(name) {
      const ns = load(name);
      return {
        get<T = unknown>(key: string): T | undefined {
          return ns.get(key) as unknown as T;
        },
        set<T = unknown>(key: string, value: T): void {
          ns.set(key, value as unknown);
          persist(name, ns);
        },
        delete(key: string): void {
          ns.delete(key);
          persist(name, ns);
        },
        list(): string[] {
          return [...ns.keys()];
        },
      };
    },
  };
}
