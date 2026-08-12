import { describe, expect, it } from "vitest";
import { createLocalStorageStorage } from "../src/storage-local.js";

/** 最小 localStorage 假实现（vitest 无 jsdom） */
function fakeLocalStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    key: (i: number) => [...map.keys()][i] ?? null,
    // T0：length 必须是 getter（list() 用 ls().length 遍历；静态 0 会让循环永不执行）
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
  };
}

function installFake(): void {
  (globalThis as { localStorage?: unknown }).localStorage = fakeLocalStorage();
}

describe("createLocalStorageStorage", () => {
  it("U1: persists values across instances (simulated page refresh)", () => {
    installFake();
    const s1 = createLocalStorageStorage();
    s1.namespace("minex.demo").set("config", { greeting: "Hi" });

    const s2 = createLocalStorageStorage(); // 新实例 = 刷新
    expect(s2.namespace("minex.demo").get("config")).toEqual({ greeting: "Hi" });
  });

  it("namespaces are isolated", () => {
    installFake();
    const s = createLocalStorageStorage();
    s.namespace("a").set("k", 1);
    expect(s.namespace("b").get("k")).toBeUndefined();
  });

  it("rejects invalid namespace name", () => {
    installFake();
    const s = createLocalStorageStorage();
    expect(() => s.namespace("a/b")).toThrow(/invalid namespace/);
  });

  it("D2: namespace and key with dots do not collide", () => {
    installFake();
    const s = createLocalStorageStorage();
    s.namespace("a").set("b.c", "A");     // key 含点
    s.namespace("a.b").set("c", "B");     // namespace 含点
    expect(s.namespace("a").get("b.c")).toBe("A");
    expect(s.namespace("a.b").get("c")).toBe("B");
    // list 不串扰：ns("a") 只列自己的 key
    expect(s.namespace("a").list()).toEqual(["b.c"]);
    expect(s.namespace("a.b").list()).toEqual(["c"]);
  });

  it("D2: key containing colon does not collide", () => {
    installFake();
    const s = createLocalStorageStorage();
    s.namespace("a").set("b:c", "X");
    expect(s.namespace("a").get("b:c")).toBe("X");
    expect(s.namespace("a").list()).toEqual(["b:c"]);
  });

  it("D4: set undefined removes the key", () => {
    installFake();
    const s = createLocalStorageStorage();
    const ns = s.namespace("n");
    ns.set("k", 1);
    ns.set("k", undefined as unknown as number);
    expect(ns.get("k")).toBeUndefined();
    expect(ns.list()).toEqual([]);
  });

  it("D5: corrupted stored value returns undefined", () => {
    installFake();
    const s = createLocalStorageStorage();
    // 直接写坏值到 localStorage
    const ls = (globalThis as { localStorage?: { setItem: (k: string, v: string) => void } }).localStorage!;
    ls.setItem("minex:n:k", "{ not json");
    expect(s.namespace("n").get("k")).toBeUndefined();
  });
});
