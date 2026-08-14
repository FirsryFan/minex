import { describe, expect, it } from "vitest";
import {
  addOutlineEntry,
  buildContext,
  checkout,
  deleteBranch,
  deriveBranches,
  listOutlines,
  type OutlineEntry,
} from "../src/session-tree.js";
import {
  validateSession,
  type Session,
  type SessionLink,
  type SessionNode,
  type SessionNodeKind,
} from "../src/session.js";

/** 直接构造会话（nodes/links 精确可控，便于图结构测试） */
function mk(
  nodes: Array<{ id: string; kind: SessionNodeKind; content?: string; output?: unknown }>,
  links: SessionLink[],
  meta: Partial<{ currentBranchId: string; outlines: OutlineEntry[] }> = {},
): Session {
  return {
    meta: {
      id: "s1",
      type: "chat",
      title: "t",
      tags: [],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      ...meta,
    },
    activeAgents: [],
    nodes: nodes.map((n) => ({
      id: n.id,
      kind: n.kind,
      ...(n.content !== undefined ? { content: n.content } : {}),
      ...(n.output !== undefined ? { output: n.output } : {}),
      ts: "2026-01-01T00:00:00.000Z",
    })),
    links,
  };
}

/** 线性主链：ids 顺序即时间顺序（i+1 responds i） */
function chain(ids: string[]): Session {
  return mk(
    ids.map((id) => ({ id, kind: "user" as const, content: `内容${id}` })),
    ids.slice(1).map((id, i) => ({ from: id, to: ids[i], type: "responds" as const })),
  );
}

describe("deriveBranches", () => {
  it("单链会话：只主链（headNodeId = 链末端）", () => {
    expect(deriveBranches(chain(["a", "b", "c"]))).toEqual([
      { id: "main", entryNodeId: "a", nodeIds: ["a", "b", "c"], headNodeId: "c" },
    ]);
  });

  it("一个分支：主链 + branch 入口链", () => {
    const s = mk(
      [
        { id: "a", kind: "user", content: "a" },
        { id: "b", kind: "user", content: "b" },
        { id: "c", kind: "user", content: "c" },
        { id: "d", kind: "user", content: "d" },
        { id: "e", kind: "user", content: "e" },
      ],
      [
        { from: "b", to: "a", type: "responds" },
        { from: "c", to: "b", type: "responds" },
        { from: "c", to: "d", type: "branch" }, // 从主链 c 分叉 → d 是分支入口
        { from: "e", to: "d", type: "responds" },
      ],
    );
    expect(deriveBranches(s)).toEqual([
      { id: "main", entryNodeId: "a", nodeIds: ["a", "b", "c"], headNodeId: "c" },
      { id: "d", entryNodeId: "d", nodeIds: ["d", "e"], headNodeId: "e" },
    ]);
  });

  it("分支再分叉：主链 + 两层分支", () => {
    const s = mk(
      [
        { id: "a", kind: "user", content: "a" },
        { id: "b", kind: "user", content: "b" },
        { id: "c", kind: "user", content: "c" },
        { id: "d", kind: "user", content: "d" },
        { id: "e", kind: "user", content: "e" },
        { id: "f", kind: "user", content: "f" },
      ],
      [
        { from: "b", to: "a", type: "responds" },
        { from: "c", to: "b", type: "responds" },
        { from: "c", to: "d", type: "branch" },
        { from: "e", to: "d", type: "responds" },
        { from: "e", to: "f", type: "branch" }, // 分支 d 的 e 再分叉 → f
      ],
    );
    expect(deriveBranches(s)).toEqual([
      { id: "main", entryNodeId: "a", nodeIds: ["a", "b", "c"], headNodeId: "c" },
      { id: "d", entryNodeId: "d", nodeIds: ["d", "e"], headNodeId: "e" },
      { id: "f", entryNodeId: "f", nodeIds: ["f"], headNodeId: "f" },
    ]);
  });

  it("空会话 → []", () => {
    expect(deriveBranches(mk([], []))).toEqual([]);
  });
});

describe("checkout", () => {
  it("正常切换：meta.currentBranchId 更新，其余不变", () => {
    const s = mk(
      [
        { id: "a", kind: "user", content: "a" },
        { id: "b", kind: "user", content: "b" },
        { id: "d", kind: "user", content: "d" },
      ],
      [
        { from: "b", to: "a", type: "responds" },
        { from: "a", to: "d", type: "branch" },
      ],
    );
    const r = checkout(s, "d");
    expect(r.meta.currentBranchId).toBe("d");
    expect(r.nodes).toBe(s.nodes); // 其余引用不变（浅不可变）
    expect(r.links).toBe(s.links);
  });

  it("非法 branchId → 抛错", () => {
    expect(() => checkout(chain(["a", "b"]), "nonexistent")).toThrow(/分支不存在/);
  });

  it("不可变：原会话不受影响", () => {
    const s = chain(["a", "b"]);
    const r = checkout(s, "main");
    expect(r).not.toBe(s);
    expect(s.meta.currentBranchId).toBeUndefined(); // 原会话未改
  });
});

describe("deleteBranch（git 三规则）", () => {
  it("孤儿分支可删：节点 + 关联链接（responds/branch 均清），其他链保留", () => {
    const s = mk(
      [
        { id: "a", kind: "user", content: "a" },
        { id: "b", kind: "user", content: "b" },
        { id: "d", kind: "user", content: "d" },
        { id: "e", kind: "user", content: "e" },
      ],
      [
        { from: "b", to: "a", type: "responds" },
        { from: "a", to: "d", type: "branch" },
        { from: "e", to: "d", type: "responds" },
      ],
    );
    const { session: r, error } = deleteBranch(s, "d");
    expect(error).toBeUndefined();
    expect(r.nodes.map((n) => n.id)).toEqual(["a", "b"]); // d/e 删除
    expect(r.links).toEqual([{ from: "b", to: "a", type: "responds" }]); // 创建链接（a→d）也清
  });

  it("当前分支拒删", () => {
    const s = mk(
      [
        { id: "a", kind: "user", content: "a" },
        { id: "d", kind: "user", content: "d" },
      ],
      [{ from: "a", to: "d", type: "branch" }],
      { currentBranchId: "d" },
    );
    const { session: r, error } = deleteBranch(s, "d");
    expect(error).toContain("当前分支不可删除，请先切换");
    expect(r).toBe(s); // 原样返回
  });

  it("被引用分支拒删：有分支基于此分叉，列出引用者", () => {
    const s = mk(
      [
        { id: "a", kind: "user", content: "a" },
        { id: "d", kind: "user", content: "d" },
        { id: "e", kind: "user", content: "e" },
        { id: "f", kind: "user", content: "f" },
      ],
      [
        { from: "a", to: "d", type: "branch" },
        { from: "e", to: "d", type: "responds" },
        { from: "e", to: "f", type: "branch" }, // f 基于 d 分支的 e 分叉
      ],
    );
    const { session: r, error } = deleteBranch(s, "d");
    expect(error).toContain("有分支基于此分叉，不可删除");
    expect(error).toContain("f"); // 列出引用者（f 分支入口）
    expect(r).toBe(s);
  });

  it("分支不存在 → error（不抛错）", () => {
    const { error } = deleteBranch(chain(["a"]), "ghost");
    expect(error).toContain("分支不存在");
  });
});

describe("buildContext", () => {
  const s = mk(
    [
      { id: "a", kind: "user", content: "甲" },
      { id: "b", kind: "assistant", content: "乙" },
      { id: "c", kind: "user", content: "丙" },
      { id: "t", kind: "tool", output: "工具结果" },
    ],
    [
      { from: "b", to: "a", type: "responds" },
      { from: "c", to: "b", type: "responds" },
      { from: "t", to: "c", type: "responds" },
    ],
  );

  it("只尾部（默认 tailCount=10）：ref 均为 parent:tail，链序输出", () => {
    const items = buildContext(s, "main");
    expect(items.map((i) => i.ref)).toEqual(["parent:tail", "parent:tail", "parent:tail", "parent:tail"]);
    expect(items.map((i) => i.content)).toEqual(["甲", "乙", "丙", "工具结果"]);
  });

  it("只框选：显式引用按链中顺序，ref = 节点 id", () => {
    const items = buildContext(s, "main", { selectedNodeIds: ["c", "a"] }); // 逆序传入
    expect(items.slice(0, 2)).toEqual([
      { ref: "a", content: "甲" },
      { ref: "c", content: "丙" },
    ]);
    // 尾部补全剩余（去重：a/c 已显式，只补 b/t）
    expect(items.slice(2).map((i) => i.content)).toEqual(["乙", "工具结果"]);
  });

  it("混合去重：显式优先，尾部跳过已收集内容", () => {
    const items = buildContext(s, "main", { selectedNodeIds: ["b"] });
    expect(items).toEqual([
      { ref: "b", content: "乙" },
      { ref: "parent:tail", content: "甲" },
      { ref: "parent:tail", content: "丙" },
      { ref: "parent:tail", content: "工具结果" },
    ]);
  });

  it("tailCount 限制：只取链末端最近 N 条", () => {
    const items = buildContext(s, "main", { tailCount: 2 });
    expect(items.map((i) => i.content)).toEqual(["丙", "工具结果"]);
  });

  it("非法 branchId → 抛错", () => {
    expect(() => buildContext(s, "ghost")).toThrow(/分支不存在/);
  });
});

describe("大纲记忆（OutlineEntry）", () => {
  function entry(id: string, kind: OutlineEntry["kind"], summary: string): OutlineEntry {
    return { id, ts: "2026-01-01T00:00:00.000Z", kind, summary, payload: "t: 标记\nk: 内容" };
  }

  it("追加：不可变，meta.outlines 逐条追加", () => {
    const s = chain(["a"]);
    const r1 = addOutlineEntry(s, entry("e1", "context", "第一条"));
    const r2 = addOutlineEntry(r1, entry("e2", "lesson", "第二条"));
    expect(s.meta.outlines).toBeUndefined(); // 原会话不变
    expect(r1.meta.outlines).toHaveLength(1);
    expect(r2.meta.outlines?.map((o) => o.id)).toEqual(["e1", "e2"]);
  });

  it("同 id 去重：保留首条", () => {
    const s = addOutlineEntry(chain(["a"]), entry("e1", "context", "初版"));
    const r = addOutlineEntry(s, { ...entry("e1", "lesson", "新版"), payload: "x" });
    expect(r.meta.outlines).toHaveLength(1);
    expect(r.meta.outlines![0].summary).toBe("初版");
  });

  it("listOutlines：按 kind 过滤；缺省返回全部副本", () => {
    const s = addOutlineEntry(
      addOutlineEntry(addOutlineEntry(chain(["a"]), entry("e1", "context", "c1")), entry("e2", "lesson", "l1")),
      entry("e3", "fact", "f1"),
    );
    expect(listOutlines(s).map((o) => o.id)).toEqual(["e1", "e2", "e3"]);
    expect(listOutlines(s, "context").map((o) => o.id)).toEqual(["e1"]);
    expect(listOutlines(s, "summary")).toEqual([]);
  });
});

describe("validateSession 扩展（2-1）", () => {
  it("含 currentBranchId + 合法 outlines（payload 任意字符串）→ 通过", () => {
    const s = mk(
      [{ id: "a", kind: "user", content: "a" }],
      [],
      {
        currentBranchId: "main",
        outlines: [
          { id: "e1", ts: "2026-01-01T00:00:00.000Z", kind: "context", summary: "s", payload: "任意\n文本\r\n  x", sourceBranchId: "main", sourceNodeIds: ["a"] },
        ],
      },
    );
    expect(validateSession(s)).toBe(true);
  });

  it("outlines 骨架必填缺失（缺 summary）→ 拒绝", () => {
    const s = mk([{ id: "a", kind: "user", content: "a" }], [], {
      outlines: [{ id: "e1", ts: "t", kind: "context", payload: "x" }] as unknown as OutlineEntry[],
    });
    expect(validateSession(s)).toBe(false);
  });

  it("outlines 非法 kind / 非字符串 id → 拒绝", () => {
    const badKind = mk([{ id: "a", kind: "user", content: "a" }], [], {
      outlines: [{ id: "e1", ts: "t", kind: "evil", summary: "s", payload: "x" }] as unknown as OutlineEntry[],
    });
    expect(validateSession(badKind)).toBe(false);
    const badId = mk([{ id: "a", kind: "user", content: "a" }], [], {
      outlines: [{ id: 1, ts: "t", kind: "context", summary: "s", payload: "x" }] as unknown as OutlineEntry[],
    });
    expect(validateSession(badId)).toBe(false);
  });

  it("currentBranchId 非字符串 → 拒绝；旧数据（无新字段）→ 通过", () => {
    const s = mk([{ id: "a", kind: "user", content: "a" }], [], {});
    (s.meta as { currentBranchId?: unknown }).currentBranchId = 123;
    expect(validateSession(s)).toBe(false);
    expect(validateSession(chain(["a"]))).toBe(true); // 旧数据无新字段仍通过
  });
});
