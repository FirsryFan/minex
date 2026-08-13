import { describe, expect, it } from "vitest";
import { baseName, isMarkdownFile, isSessionFile, joinPath, parentPath, resolveSafePath } from "../src/path.js";

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

describe("isMarkdownFile", () => {
  it("recognizes .md / .markdown ignoring case", () => {
    expect(isMarkdownFile("README.md")).toBe(true);
    expect(isMarkdownFile("notes.MARKDOWN")).toBe(true);
    expect(isMarkdownFile("a/b/c.md")).toBe(true);
  });
  it("rejects non-markdown extensions", () => {
    expect(isMarkdownFile("a.txt")).toBe(false);
    expect(isMarkdownFile("a.md.txt")).toBe(false);
    expect(isMarkdownFile("a.js")).toBe(false);
  });
  it("rejects hidden files / no extension / empty", () => {
    expect(isMarkdownFile(".md")).toBe(false);
    expect(isMarkdownFile("a.")).toBe(false);
    expect(isMarkdownFile("a")).toBe(false);
    expect(isMarkdownFile("")).toBe(false);
  });
});

describe("isSessionFile", () => {
  it("recognizes .ses ignoring case", () => {
    expect(isSessionFile("abc.ses")).toBe(true);
    expect(isSessionFile("a/b/note.SES")).toBe(true);
  });
  it("rejects other / no extension / hidden", () => {
    expect(isSessionFile("a.md")).toBe(false);
    expect(isSessionFile("a")).toBe(false);
    expect(isSessionFile(".ses")).toBe(false);
    expect(isSessionFile("a.")).toBe(false);
  });
});
