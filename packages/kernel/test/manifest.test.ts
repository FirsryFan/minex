import { describe, expect, it } from "vitest";
import { parseManifest } from "../src/index.js";

describe("parseManifest", () => {
  it("parses a minimal valid manifest", () => {
    const m = parseManifest({ id: "minex.demo", name: "Demo", version: "1.0.0" });
    expect(m).toEqual({ id: "minex.demo", name: "Demo", version: "1.0.0" });
  });

  it("parses optional fields", () => {
    const m = parseManifest({
      id: "minex.demo",
      name: "Demo",
      version: "1.0.0",
      minKernelVersion: "0.1.0",
      dependencies: ["minex.base"],
      settingsSchema: { type: "object" },
      reloadable: false,
      contributes: { ui: [{ id: "p", location: "left" }] },
      entry: "./index.js",
    });
    expect(m.minKernelVersion).toBe("0.1.0");
    expect(m.dependencies).toEqual(["minex.base"]);
    expect(m.reloadable).toBe(false);
    expect(m.entry).toBe("./index.js");
  });

  it("rejects non-object", () => {
    expect(() => parseManifest(null)).toThrow(/object/);
    expect(() => parseManifest("x")).toThrow(/object/);
    expect(() => parseManifest([1, 2])).toThrow(/object/);
  });

  it("rejects missing or invalid id", () => {
    expect(() => parseManifest({ name: "x", version: "1.0.0" })).toThrow(/id/);
    expect(() => parseManifest({ id: "bad id!", name: "x", version: "1.0.0" })).toThrow(/id/);
    expect(() => parseManifest({ id: 42, name: "x", version: "1.0.0" })).toThrow(/id/);
  });

  it("rejects missing name or version", () => {
    expect(() => parseManifest({ id: "a.b", version: "1.0.0" })).toThrow(/name/);
    expect(() => parseManifest({ id: "a.b", name: "x" })).toThrow(/version/);
  });

  it("rejects wrong types for optional fields", () => {
    expect(() => parseManifest({ id: "a.b", name: "x", version: "1", dependencies: "not-array" })).toThrow(/dependencies/);
    expect(() => parseManifest({ id: "a.b", name: "x", version: "1", settingsSchema: [] })).toThrow(/settingsSchema/);
    expect(() => parseManifest({ id: "a.b", name: "x", version: "1", reloadable: "yes" })).toThrow(/reloadable/);
    expect(() => parseManifest({ id: "a.b", name: "x", version: "1", contributes: 5 })).toThrow(/contributes/);
  });
});
