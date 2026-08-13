import { describe, expect, it } from "vitest";
import { baseName, joinPath, parentPath, resolveSafePath } from "../src/path.js";

describe("resolveSafePath", () => {
  it("normalizes relative path", () => {
    expect(resolveSafePath("a/b/c")).toBe("a/b/c");
    expect(resolveSafePath("a//b/./c")).toBe("a/b/c");
  });
  it("rejects absolute paths", () => {
    expect(() => resolveSafePath("/a")).toThrow();
    expect(() => resolveSafePath("C:/a")).toThrow();
  });
  it("rejects .. escape", () => {
    expect(() => resolveSafePath("../a")).toThrow();
    expect(() => resolveSafePath("a/../../etc")).toThrow();
  });
  it("handles backslashes", () => {
    expect(resolveSafePath("a\\b\\c")).toBe("a/b/c");
  });
});

describe("joinPath / parentPath / baseName", () => {
  it("joins", () => {
    expect(joinPath("a/b", "c.md")).toBe("a/b/c.md");
    expect(joinPath("", "c.md")).toBe("c.md");
  });
  it("parent", () => {
    expect(parentPath("a/b/c")).toBe("a/b");
    expect(parentPath("a")).toBe("");
  });
  it("basename", () => {
    expect(baseName("a/b/c.md")).toBe("c.md");
    expect(baseName("c.md")).toBe("c.md");
  });
});
