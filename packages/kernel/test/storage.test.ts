import * as fs from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { createInMemoryStorage, createJsonFileStorage } from "../src/index.js";

describe("storage", () => {
  it("namespaces are isolated", () => {
    const s = createInMemoryStorage();
    const a = s.namespace("a");
    const b = s.namespace("b");
    a.set("k", 1);
    expect(b.get("k")).toBeUndefined();
  });

  it("set / get / delete / list", () => {
    const s = createInMemoryStorage();
    const ns = s.namespace("n");
    ns.set("x", { v: 1 });
    ns.set("y", 2);
    expect(ns.get("x")).toEqual({ v: 1 });
    expect(ns.list().sort()).toEqual(["x", "y"]);
    ns.delete("x");
    expect(ns.get("x")).toBeUndefined();
    expect(ns.list()).toEqual(["y"]);
  });

  it("same namespace shares data across views", () => {
    const s = createInMemoryStorage();
    s.namespace("n").set("k", "v");
    expect(s.namespace("n").get("k")).toBe("v");
  });

  it("JSON file storage persists across instances", () => {
    const dir = path.join(tmpdir(), `minex-storage-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    try {
      const s1 = createJsonFileStorage(dir);
      s1.namespace("minex.demo").set("k", { v: 1 });
      const s2 = createJsonFileStorage(dir); // 新实例读盘
      expect(s2.namespace("minex.demo").get("k")).toEqual({ v: 1 });
      expect(s2.namespace("other").get("k")).toBeUndefined(); // 命名空间隔离落盘
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects invalid namespace name", () => {
    const dir = path.join(tmpdir(), `minex-storage-invalid-${Date.now()}`);
    try {
      const s = createJsonFileStorage(dir);
      expect(() => s.namespace("a/b")).toThrow(/invalid namespace/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects non-serializable values", () => {
    const dir = path.join(tmpdir(), `minex-storage-cyclic-${Date.now()}`);
    try {
      const s = createJsonFileStorage(dir);
      const cyclic: Record<string, unknown> = {};
      cyclic.self = cyclic;
      expect(() => s.namespace("n").set("k", cyclic)).toThrow(/not JSON-serializable/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
