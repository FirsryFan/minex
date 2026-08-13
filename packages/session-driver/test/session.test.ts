import { describe, expect, it } from "vitest";
import {
  addLink,
  addNode,
  buildLinearLinks,
  createSession,
  filterByTag,
  parseMainChain,
  rebuildFromMarkdown,
  removeNode,
  searchSessions,
  toIndexEntry,
  toMarkdown,
  updateMeta,
  validateSession,
  validateSessionIndex,
  validateType,
} from "../src/session.js";

const NOW = "2026-08-13T00:00:00.000Z";

describe("createSession", () => {
  it("creates with defaults", () => {
    const s = createSession({ id: "a", now: NOW });
    expect(s.meta.id).toBe("a");
    expect(s.meta.type).toBe("chat");
    expect(s.meta.title).toBe("未命名会话");
    expect(s.meta.tags).toEqual([]);
    expect(s.activeAgents).toEqual([]);
    expect(s.nodes).toEqual([]);
    expect(s.links).toEqual([]);
    expect(s.meta.createdAt).toBe(NOW);
    expect(s.meta.updatedAt).toBe(NOW);
  });
  it("accepts explicit fields and copies tags (not by reference)", () => {
    const tags = ["md"];
    const s = createSession({ id: "b", type: "flow", title: "工作流", tags, activeAgents: ["mist.agent.assistant"], now: NOW });
    expect(s.meta.type).toBe("flow");
    expect(s.meta.title).toBe("工作流");
    expect(s.activeAgents).toEqual(["mist.agent.assistant"]);
    tags.push("x"); // 外部改动不影响会话内 tags
    expect(s.meta.tags).toEqual(["md"]);
  });
  it("generates unique id when omitted", () => {
    const a = createSession({ now: NOW }).meta.id;
    const b = createSession({ now: NOW }).meta.id;
    expect(a).not.toBe(b);
  });
});

describe("addNode / addLink / removeNode（不可变操作）", () => {
  it("addNode appends and refreshes updatedAt", () => {
    const s = addNode(createSession({ id: "a", now: NOW }), { id: "n1", kind: "user", content: "hi", ts: NOW }, "2026-08-13T01:00:00.000Z");
    expect(s.nodes).toHaveLength(1);
    expect(s.nodes[0].content).toBe("hi");
    expect(s.meta.updatedAt).toBe("2026-08-13T01:00:00.000Z");
  });
  it("does not mutate the input session", () => {
    const base = createSession({ id: "a", now: NOW });
    addNode(base, { id: "n1", kind: "user", content: "hi", ts: NOW }, NOW);
    expect(base.nodes).toHaveLength(0);
    expect(base.links).toHaveLength(0);
  });
  it("addLink dedups identical links and keeps distinct ones", () => {
    let s = createSession({ id: "a", now: NOW });
    const link = { from: "n2", to: "n1", type: "responds" as const };
    s = addLink(s, link);
    s = addLink(s, link);
    expect(s.links).toHaveLength(1);
    s = addLink(s, { from: "n3", to: "n2", type: "agent-flow" as const });
    expect(s.links).toHaveLength(2);
  });
  it("removeNode removes node and its related links", () => {
    let s = createSession({ id: "a", now: NOW });
    s = addNode(s, { id: "n1", kind: "user", content: "a", ts: NOW });
    s = addNode(s, { id: "n2", kind: "assistant", content: "b", ts: NOW });
    s = addLink(s, { from: "n2", to: "n1", type: "responds" });
    s = removeNode(s, "n1", NOW);
    expect(s.nodes.map((n) => n.id)).toEqual(["n2"]);
    expect(s.links).toEqual([]);
  });
});

describe("updateMeta / toIndexEntry", () => {
  it("updateMeta patches title and tags, refreshes updatedAt", () => {
    const s = updateMeta(createSession({ id: "a", tags: ["x"], now: NOW }), { title: "新标题", tags: ["y"] }, "2026-08-13T02:00:00.000Z");
    expect(s.meta.title).toBe("新标题");
    expect(s.meta.tags).toEqual(["y"]);
    expect(s.meta.updatedAt).toBe("2026-08-13T02:00:00.000Z");
  });
  it("toIndexEntry extracts lightweight fields", () => {
    let s = createSession({ id: "a", type: "chat", title: "t", tags: ["md"], now: NOW });
    s = addNode(s, { id: "n1", kind: "user", content: "x", ts: NOW }, NOW);
    expect(toIndexEntry(s)).toEqual({ id: "a", type: "chat", title: "t", tags: ["md"], updatedAt: NOW, nodeCount: 1 });
  });
});

describe("searchSessions / filterByTag", () => {
  const index = {
    version: 1 as const,
    sessions: [
      { id: "a", type: "chat", title: "调试 markdown", tags: ["md", "bug"], updatedAt: NOW, nodeCount: 3 },
      { id: "b", type: "flow", title: "多 agent 流水线", tags: ["agent"], updatedAt: NOW, nodeCount: 5 },
    ],
  };
  it("empty query returns all", () => {
    expect(searchSessions(index, "  ")).toHaveLength(2);
  });
  it("matches title / tag / id case-insensitively", () => {
    expect(searchSessions(index, "markdown")).toHaveLength(1); // a.title
    expect(searchSessions(index, "AGENT")).toHaveLength(1); // b.title
    expect(searchSessions(index, "bug")).toHaveLength(1); // a.tags
  });
  it("filterByTag filters and null returns all", () => {
    expect(filterByTag(index, "md")).toHaveLength(1);
    expect(filterByTag(index, "none")).toHaveLength(0);
    expect(filterByTag(index, null)).toHaveLength(2);
  });
});

describe("toMarkdown（主链渲染，供 markdown 视图）", () => {
  it("renders user / assistant / tool nodes", () => {
    let s = createSession({ id: "a", title: "标题", now: NOW });
    s = addNode(s, { id: "n1", kind: "user", content: "你好", ts: NOW });
    s = addNode(s, { id: "n2", kind: "assistant", agentId: "mist.agent.assistant", content: "**欢迎**", ts: NOW });
    s = addNode(s, { id: "n3", kind: "tool", toolName: "filesystem.readFile", input: { path: "a.md" }, output: "ok", ts: NOW });
    const md = toMarkdown(s);
    expect(md).toContain("# 标题");
    expect(md).toContain("## 你");
    expect(md).toContain("## mist.agent.assistant");
    expect(md).toContain("**欢迎**");
    expect(md).toContain("filesystem.readFile");
  });
});

describe("validateSession / validateSessionIndex / validateType", () => {
  it("accepts a round-tripped session", () => {
    const s = createSession({ id: "a", tags: ["x"], now: NOW });
    expect(validateSession(JSON.parse(JSON.stringify(s)))).toBe(true);
  });
  it("rejects malformed input", () => {
    expect(validateSession(null)).toBe(false);
    expect(validateSession({})).toBe(false);
    expect(validateSession({ meta: { id: "a" }, nodes: [], links: [] })).toBe(false);
    const badNode = { ...createSession({ id: "a", now: NOW }), nodes: [{ id: "x" }] }; // 缺 kind/ts
    expect(validateSession(badNode)).toBe(false);
  });
  it("validateSessionIndex", () => {
    expect(validateSessionIndex({ version: 1, sessions: [] })).toBe(true);
    expect(validateSessionIndex({ version: 2, sessions: [] })).toBe(false);
    expect(validateSessionIndex({})).toBe(false);
  });
  it("validateType guards path segments", () => {
    expect(validateType("chat")).toBe(true);
    expect(validateType("chat-flow_2")).toBe(true);
    expect(validateType("A")).toBe(false); // 大写拒绝（路径安全）
    expect(validateType("a/b")).toBe(false); // 路径分隔拒绝
    expect(validateType("")).toBe(false);
    expect(validateType("a".repeat(33))).toBe(false); // 超长
  });
  it("rejects invalid meta.type（自包含校验，审查 m1）", () => {
    const bad = createSession({ id: "a", type: "chat", now: NOW });
    bad.meta.type = "A/../../evil";
    expect(validateSession(bad)).toBe(false);
  });
});

describe("parseMainChain / buildLinearLinks / rebuildFromMarkdown（markdown ↔ 主链）", () => {
  it("parseMainChain splits user/assistant blocks by ##", () => {
    const nodes = parseMainChain("# 标题\n\n## 你\n\n你好\n\n## mist.agent.assistant\n\n**回复**", NOW);
    expect(nodes).toHaveLength(2);
    expect(nodes[0].kind).toBe("user");
    expect(nodes[0].content).toBe("你好");
    expect(nodes[1].kind).toBe("assistant");
    expect(nodes[1].agentId).toBe("mist.agent.assistant");
    expect(nodes[1].content).toBe("**回复**");
  });
  it("empty doc / title-only produce no nodes", () => {
    expect(parseMainChain("")).toEqual([]);
    expect(parseMainChain("# 只有标题")).toEqual([]);
  });
  it("non-## lines join current block (tool text becomes content)", () => {
    const nodes = parseMainChain("## 你\n\n一\n### 工具调用：x\n```json\n{}\n```", NOW);
    expect(nodes).toHaveLength(1);
    expect(nodes[0].content).toContain("### 工具调用：x");
  });
  it("buildLinearLinks chains responds edges", () => {
    expect(buildLinearLinks([])).toEqual([]);
    const single = parseMainChain("## 你\n1", NOW);
    expect(buildLinearLinks(single)).toEqual([]);
    const nodes = parseMainChain("## 你\n1\n\n## 助手\n2\n\n## 你\n3", NOW);
    const links = buildLinearLinks(nodes);
    expect(links).toHaveLength(2);
    expect(links[0].from).toBe(nodes[1].id);
    expect(links[0].to).toBe(nodes[0].id);
    expect(links[0].type).toBe("responds");
  });
  it("rebuildFromMarkdown preserves meta/activeAgents and rebuilds nodes+links", () => {
    const base = createSession({ id: "s1", type: "chat", title: "标题", tags: ["md"], activeAgents: ["a1"], now: NOW });
    const rebuilt = rebuildFromMarkdown(base, "## 你\nhi", "2026-08-13T03:00:00.000Z");
    expect(rebuilt.meta.title).toBe("标题");
    expect(rebuilt.meta.id).toBe("s1");
    expect(rebuilt.meta.type).toBe("chat");
    expect(rebuilt.activeAgents).toEqual(["a1"]);
    expect(rebuilt.nodes).toHaveLength(1);
    expect(rebuilt.meta.updatedAt).toBe("2026-08-13T03:00:00.000Z");
  });
});
