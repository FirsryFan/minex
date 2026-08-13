import { describe, expect, it } from "vitest";
import { createEventBus } from "@minex/kernel";
import { onEnvelope, parseEnvelope, sendEnvelope, serializeEnvelope } from "../src/envelope.js";

describe("parseEnvelope", () => {
  it("必填缺失抛错", () => {
    expect(() => parseEnvelope(null)).toThrow();
    expect(() => parseEnvelope({})).toThrow();
    expect(() => parseEnvelope({ from: "a", type: "task" })).toThrow(); // 缺 to
    expect(() => parseEnvelope({ from: "a", to: "b" })).toThrow(); // 缺 type
  });
  it("可选字段取默认", () => {
    const e = parseEnvelope({ from: "a", to: "b", type: "task", payload: 42 });
    expect(e.priority).toBe(0);
    expect(e.deadline).toBe(0);
    expect(e.deps).toEqual([]);
  });
  it("payload 透传（任意类型）", () => {
    expect(parseEnvelope({ from: "a", to: "b", type: "t", payload: { x: 1 } }).payload).toEqual({ x: 1 });
    expect(parseEnvelope({ from: "a", to: "b", type: "t", payload: "文本" }).payload).toBe("文本");
    expect(parseEnvelope({ from: "a", to: "b", type: "t", payload: null }).payload).toBeNull();
  });
  it("deps 过滤非字符串", () => {
    const e = parseEnvelope({ from: "a", to: "b", type: "t", deps: ["x", 1, null] });
    expect(e.deps).toEqual(["x"]);
  });
});

describe("serializeEnvelope", () => {
  it("字段序固定，两次字节一致", () => {
    const env = { from: "a", to: "b", type: "t", priority: 1, deadline: 2, deps: ["x"], payload: {} };
    const s1 = serializeEnvelope(env);
    const s2 = serializeEnvelope(env);
    expect(s1).toBe(s2);
    expect(s1.indexOf('"from"')).toBeLessThan(s1.indexOf('"to"'));
    expect(s1.indexOf('"to"')).toBeLessThan(s1.indexOf('"type"'));
    expect(s1.indexOf('"type"')).toBeLessThan(s1.indexOf('"payload"'));
  });
});

describe("sendEnvelope / onEnvelope", () => {
  it("定向只送达目标，不串扰", () => {
    const bus = createEventBus();
    const a: string[] = [];
    const b: string[] = [];
    onEnvelope(bus, "agentA", (e) => a.push(e.type));
    onEnvelope(bus, "agentB", (e) => b.push(e.type));
    sendEnvelope(bus, { from: "mgr", to: "agentA", type: "task", payload: {} });
    expect(a).toEqual(["task"]);
    expect(b).toEqual([]);
  });
  it("* 广播送达全体", () => {
    const bus = createEventBus();
    const a: string[] = [];
    const b: string[] = [];
    onEnvelope(bus, "agentA", (e) => a.push(e.type));
    onEnvelope(bus, "agentB", (e) => b.push(e.type));
    sendEnvelope(bus, { from: "mgr", to: "*", type: "notice", payload: {} });
    expect(a).toEqual(["notice"]);
    expect(b).toEqual(["notice"]);
  });
  it("退订后不再收到", () => {
    const bus = createEventBus();
    const received: string[] = [];
    const off = onEnvelope(bus, "agentA", (e) => received.push(e.type));
    off();
    sendEnvelope(bus, { from: "mgr", to: "agentA", type: "task", payload: {} });
    expect(received).toEqual([]);
  });
});
