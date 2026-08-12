import { describe, expect, it } from "vitest";
import { createInMemoryStorage } from "../src/index.js";

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
});
