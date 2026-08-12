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
    length: 0,
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
});
