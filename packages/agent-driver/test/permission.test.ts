import { describe, expect, it } from "vitest";
import { checkPermission, PERMISSION_MODES } from "../src/permission.js";

describe("checkPermission（3-2 权限三档）", () => {
  it("auto：read/write/run 全部 allow", () => {
    expect(checkPermission({ name: "read_file", risk: "read" }, "auto")).toBe("allow");
    expect(checkPermission({ name: "write_file", risk: "write" }, "auto")).toBe("allow");
    expect(checkPermission({ name: "run_tool", risk: "run" }, "auto")).toBe("allow");
  });

  it("edit：read/write allow、run ask", () => {
    expect(checkPermission({ name: "read_file", risk: "read" }, "edit")).toBe("allow");
    expect(checkPermission({ name: "write_file", risk: "write" }, "edit")).toBe("allow");
    expect(checkPermission({ name: "run_tool", risk: "run" }, "edit")).toBe("ask");
  });

  it("manual：read allow、write/run ask", () => {
    expect(checkPermission({ name: "read_file", risk: "read" }, "manual")).toBe("allow");
    expect(checkPermission({ name: "write_file", risk: "write" }, "manual")).toBe("ask");
    expect(checkPermission({ name: "run_tool", risk: "run" }, "manual")).toBe("ask");
  });

  it("按工具覆盖优先：manual 模式覆盖 write 工具为 auto → allow；auto 模式覆盖 run 工具为 manual → ask", () => {
    expect(checkPermission({ name: "write_file", risk: "write" }, "manual", { write_file: "auto" })).toBe("allow");
    expect(checkPermission({ name: "run_tool", risk: "run" }, "auto", { run_tool: "manual" })).toBe("ask");
  });

  it("覆盖只作用于指定工具：其他工具仍按模式裁决", () => {
    expect(checkPermission({ name: "write_file", risk: "write" }, "manual", { other: "auto" })).toBe("ask");
    expect(checkPermission({ name: "read_file", risk: "read" }, "edit", { read_file: "manual" })).toBe("allow"); // read 恒 allow
  });

  it("缺省（无 overrides）：与纯 mode 裁决一致；内置三档常量齐全", () => {
    expect(PERMISSION_MODES).toEqual(["auto", "edit", "manual"]);
    expect(checkPermission({ name: "x", risk: "write" }, "auto", {})).toBe("allow");
    expect(checkPermission({ name: "x", risk: "run" }, "manual", {})).toBe("ask");
  });
});
