import { describe, expect, it } from "vitest";
import { BUILTIN_PERSONAS, validatePersona, type Persona } from "../src/persona.js";

function ok(extra: Partial<Persona> = {}): Persona {
  return {
    id: "minex.persona.researcher",
    name: "研究者",
    systemPrompt: "你是一个严谨的研究助手。",
    ...extra,
  };
}

describe("validatePersona", () => {
  it("合法 persona → true（骨架 + 可选字段齐全）", () => {
    expect(
      validatePersona({
        id: "p1",
        name: "研究者",
        description: "严谨研究",
        systemPrompt: "你是一个严谨的研究助手，回答要分点。",
        tools: ["echo"],
        autoAdopt: true,
        slots: { style: "分点" }, // payload 类字段自由
      }),
    ).toBe(true);
  });

  it("缺 systemPrompt → false（骨架必填）", () => {
    expect(validatePersona({ id: "p1", name: "研究者" })).toBe(false);
  });

  it("缺 id 或 name → false", () => {
    expect(validatePersona({ name: "研究者", systemPrompt: "x" })).toBe(false);
    expect(validatePersona({ id: "p1", systemPrompt: "x" })).toBe(false);
  });

  it("tools 非数组 → false；含非字符串元素 → false", () => {
    expect(validatePersona({ ...ok(), tools: "echo" })).toBe(false);
    expect(validatePersona({ ...ok(), tools: ["echo", 1] })).toBe(false);
  });

  it("description 非字符串 / autoAdopt 非布尔 → false；slots 任意形状可存", () => {
    expect(validatePersona({ ...ok(), description: 1 })).toBe(false);
    expect(validatePersona({ ...ok(), autoAdopt: "yes" })).toBe(false);
    expect(validatePersona({ ...ok(), slots: { nested: { a: [1, 2] } } })).toBe(true);
  });

  it("内置 4 persona 全部通过校验；预读助教（tutor）systemPrompt 覆盖教学场景", () => {
    expect(BUILTIN_PERSONAS).toHaveLength(4);
    for (const p of BUILTIN_PERSONAS) expect(validatePersona(p)).toBe(true);
    const tutor = BUILTIN_PERSONAS.find((p) => p.id === "minex.persona.tutor");
    expect(tutor?.name).toBe("预读助教");
    expect(tutor?.systemPrompt).toContain("1v1 助教");
    expect(tutor?.systemPrompt).toContain("预演");
  });
});
