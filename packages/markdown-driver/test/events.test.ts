import { describe, expect, it } from "vitest";
import { isOpenFilePayload } from "../src/events.js";

describe("isOpenFilePayload", () => {
  it("accepts { path: string }", () => {
    expect(isOpenFilePayload({ path: "a/b.md" })).toBe(true);
    expect(isOpenFilePayload({ path: "" })).toBe(true);
  });
  it("rejects non-object and null", () => {
    expect(isOpenFilePayload(null)).toBe(false);
    expect(isOpenFilePayload(undefined)).toBe(false);
    expect(isOpenFilePayload("a/b.md")).toBe(false);
    expect(isOpenFilePayload(42)).toBe(false);
    expect(isOpenFilePayload([])).toBe(false);
  });
  it("rejects object without string path", () => {
    expect(isOpenFilePayload({})).toBe(false);
    expect(isOpenFilePayload({ path: 123 })).toBe(false);
    expect(isOpenFilePayload({ path: null })).toBe(false);
    expect(isOpenFilePayload({ other: "x" })).toBe(false);
  });
});
