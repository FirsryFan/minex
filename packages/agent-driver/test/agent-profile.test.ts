import { describe, expect, it } from "vitest";
import {
  BUILTIN_SKILLS,
  deleteAgentProfile,
  loadAgentProfiles,
  saveAgentProfile,
  validateAgentProfile,
  type AgentProfile,
} from "../src/agent-profile.js";
import { createInMemoryStorage, createKernel } from "@minex/kernel";

function ok(extra: Partial<AgentProfile> = {}): AgentProfile {
  return { id: "agent.study-tutor", name: "研究助理", ...extra };
}

describe("validateAgentProfile（F-C）", () => {
  it("合法档案（骨架 + 可选字段齐全）→ true", () => {
    expect(
      validateAgentProfile(
        ok({
          avatar: "🎓",
          description: "研究",
          personaId: "minex.persona.researcher",
          systemPrompt: "自定义",
          tools: ["read_file", "list_sessions"],
          skills: ["skill.structured"],
          memory: { outlines: true },
          model: "deepseek-chat",
          permissionMode: "edit",
          params: { temperature: 0.4 },
          filePool: ["论文.md"],
          slots: { code: "```ts\nconst a=1;\n```" },
        }),
      ),
    ).toBe(true);
  });

  it("缺 id 或 name → false（骨架必填）", () => {
    expect(validateAgentProfile({ name: "x" })).toBe(false);
    expect(validateAgentProfile({ id: "a" })).toBe(false);
    expect(validateAgentProfile(null)).toBe(false);
  });

  it("tools 非数组/含非字符串 → false；tools=null（全部）合法；skills 非数组 → false", () => {
    expect(validateAgentProfile(ok({ tools: "read_file" }))).toBe(false);
    expect(validateAgentProfile(ok({ tools: ["read_file", 1] }))).toBe(false);
    expect(validateAgentProfile(ok({ tools: null }))).toBe(true);
    expect(validateAgentProfile(ok({ skills: "skill" }))).toBe(false);
    expect(validateAgentProfile(ok({ skills: ["skill.structured", 2] }))).toBe(false);
  });

  it("memory 形状错 / permissionMode 枚举错 / filePool 非数组 → false；params/slots payload 自由", () => {
    expect(validateAgentProfile(ok({ memory: "yes" }))).toBe(false);
    expect(validateAgentProfile(ok({ memory: { outlines: "yes" } }))).toBe(false);
    expect(validateAgentProfile(ok({ permissionMode: "root" }))).toBe(false);
    expect(validateAgentProfile(ok({ filePool: "a.md" }))).toBe(false);
    expect(validateAgentProfile(ok({ params: { temperature: 0.3, nested: { a: [1] } }, slots: { code: "x" } }))).toBe(true);
  });
});

describe("agentProfiles 存储读写（F-C/F-D）", () => {
  it("保存/读取/删除按 id 合并；损坏数据容错返回 {}", () => {
    const kernel = createKernel({ storage: createInMemoryStorage() });
    saveAgentProfile(kernel, ok());
    saveAgentProfile(kernel, ok({ id: "agent.b", name: "B" }));
    const all = loadAgentProfiles(kernel);
    expect(Object.keys(all).sort()).toEqual(["agent.b", "agent.study-tutor"]);
    expect(all["agent.b"].name).toBe("B");
    deleteAgentProfile(kernel, "agent.study-tutor");
    expect(Object.keys(loadAgentProfiles(kernel))).toEqual(["agent.b"]);
    // 损坏：直接写非法 JSON
    kernel.storage.namespace("minex.agent").set("agentProfiles", "{bad json");
    expect(loadAgentProfiles(kernel)).toEqual({});
    // 损坏条目跳过
    kernel.storage.namespace("minex.agent").set("agentProfiles", { good: ok(), bad: { id: "x" } });
    expect(Object.keys(loadAgentProfiles(kernel))).toEqual(["good"]);
  });

  it("BUILTIN_SKILLS 3 个且各有 promptBlock", () => {
    expect(BUILTIN_SKILLS.map((s) => s.id)).toEqual([
      "skill.structured",
      "skill.stepwise",
      "skill.code-review",
    ]);
    expect(BUILTIN_SKILLS.every((s) => s.name && s.promptBlock.length > 0)).toBe(true);
  });
});
