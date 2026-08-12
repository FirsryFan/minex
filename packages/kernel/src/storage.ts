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

  function assertValidName(name: string): void {
    if (!/^[A-Za-z0-9_.-]+$/.test(name)) {
      throw new Error(`Storage: invalid namespace name "${name}" (allowed: A-Za-z0-9_.-). ` +
        `拒绝非法字符而非替换，避免 "a/b" 与 "a_b" 映射到同一文件`);
    }
  }

  function fileOf(name: string): string {
    return path.join(baseDir, `${name}.json`);
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
    let json: string;
    try {
      json = JSON.stringify(obj, null, 2);
    } catch (err) {
      throw new Error(
        `Storage: value in namespace "${name}" is not JSON-serializable (${err instanceof Error ? err.message : String(err)})`,
      );
    }
    // 原子写：先写临时文件再 rename，崩溃窗口不损坏原文件
    const tmp = `${fileOf(name)}.tmp`;
    fs.writeFileSync(tmp, json, "utf8");
    fs.renameSync(tmp, fileOf(name));
  }

  return {
    namespace(name) {
      assertValidName(name); // 校验必须在入口，不能放进 load（其 try/catch 会吞掉错误）
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
