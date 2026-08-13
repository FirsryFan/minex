import { describe, expect, it } from "vitest";
import { assembleWorkMemory, buildMessages, serializeToolDef } from "../src/assembler.js";

const tool = { name: "readFile", description: "读取文件", parameters: { type: "object", properties: {} } };

describe("serializeToolDef", () => {
  it("produces byte-identical output across calls (stable order)", () => {
    const a = serializeToolDef(tool);
    const b = serializeToolDef(tool);
    expect(a).toBe(b);
    expect(JSON.parse(a)).toEqual({ name: "readFile", description: "读取文件", parameters: { type: "object", properties: {} } });
  });
  it("keeps field order name→description→parameters", () => {
    const s = serializeToolDef(tool);
    expect(s.indexOf('"name"')).toBeLessThan(s.indexOf('"description"'));
    expect(s.indexOf('"description"')).toBeLessThan(s.indexOf('"parameters"'));
  });
});

describe("buildMessages", () => {
  it("orders system → tool → history → workMemory", () => {
    const msgs = buildMessages({
      systemPrompt: "你是助手",
      tools: [tool],
      history: [{ role: "user", content: "hi" }],
      workMemory: [{ role: "assistant", content: "结果" }],
    });
    expect(msgs[0]).toEqual({ role: "system", content: "你是助手" });
    expect(msgs[1].role).toBe("tool");
    expect(msgs[1].content).toBe(serializeToolDef(tool));
    expect(msgs[2]).toEqual({ role: "user", content: "hi" });
    expect(msgs[3]).toEqual({ role: "assistant", content: "结果" });
  });
  it("appends history verbatim and workMemory at end", () => {
    const history = [
      { role: "user", content: "a" },
      { role: "assistant", content: "b" },
    ];
    const workMemory = [{ role: "tool", content: "c" }];
    const msgs = buildMessages({ systemPrompt: "s", tools: [], history, workMemory });
    expect(msgs.slice(1, 3)).toEqual(history);
    expect(msgs[msgs.length - 1]).toEqual(workMemory[0]);
  });
  it("no tools produces no tool messages", () => {
    const msgs = buildMessages({ systemPrompt: "s", tools: [], history: [], workMemory: [] });
    expect(msgs).toHaveLength(1);
    expect(msgs[0].role).toBe("system");
  });
});

describe("assembleWorkMemory", () => {
  it("passes through array verbatim", () => {
    const arr = [{ role: "assistant", content: "x" }];
    expect(assembleWorkMemory(arr)).toEqual(arr);
  });
  it("unwraps { messages }", () => {
    expect(assembleWorkMemory({ messages: [{ role: "user", content: "m" }] })).toEqual([{ role: "user", content: "m" }]);
  });
  it("returns [] for non-array / unknown", () => {
    expect(assembleWorkMemory(null)).toEqual([]);
    expect(assembleWorkMemory(42)).toEqual([]);
    expect(assembleWorkMemory({})).toEqual([]);
  });
});
