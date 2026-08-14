import { describe, expect, it } from "vitest";
import type { DriverContext } from "@minex/kernel";
import { registerRealTools } from "../src/real-tools.js";
import type { AgentTool } from "../src/tool.js";

/** 能力桩（filesystem / session / markdown），按注册的 get 分发 */
function makeCtx(overrides: {
  fs?: Partial<{
    hasRoot: () => boolean;
    readDir: (p: string) => Promise<unknown[]>;
    readFile: (p: string) => Promise<string>;
    writeFile: (p: string, c: string) => Promise<void>;
  }>;
  store?: Partial<{
    hasRoot: () => boolean;
    listSessions: () => Promise<unknown[]>;
    loadSession: (id: string) => Promise<unknown>;
    saveSession: (s: unknown) => Promise<void>;
  }>;
  md?: Partial<{ render: (src: string) => string }>;
}): { ctx: DriverContext; registered: Map<string, unknown>; saves: unknown[] } {
  const registered = new Map<string, unknown>();
  const saves: unknown[] = [];
  const fs = {
    hasRoot: () => true,
    readDir: async (p: string) => [],
    readFile: async (p: string) => `内容:${p}`,
    writeFile: async () => {},
    ...overrides.fs,
  };
  const store = {
    hasRoot: () => true,
    listSessions: async () => [],
    loadSession: async (id: string) => ({ meta: { id, title: `t-${id}` }, nodes: [{ kind: "user", content: "hi" }] }),
    saveSession: async (s: unknown) => {
      saves.push(s);
    },
    ...overrides.store,
  };
  const md = { render: (src: string) => `<p>${src}</p>`, ...overrides.md };
  const ctx = {
    manifest: { id: "minex.agent", name: "agent", version: "0.1.0" },
    register: (type: string, id: string, value: unknown) => {
      registered.set(`${type}/${id}`, value);
    },
    unregister: () => {},
    query: <T>(): T[] => [],
    get: <T>(type: string, id: string): T | undefined => {
      if (type === "filesystem" && id === "default") return fs as T;
      if (type === "session" && id === "default") return store as T;
      if (type === "markdown" && id === "render") return md as T;
      return undefined;
    },
    on: () => () => {},
    emit: () => {},
    storage: { get: () => undefined, set: () => {}, delete: () => {}, list: () => [] },
    log: { info: () => {}, warn: () => {}, error: () => {} },
  } as unknown as DriverContext;
  return { ctx, registered, saves };
}

function toolsOf(registered: Map<string, unknown>): Map<string, AgentTool> {
  const m = new Map<string, AgentTool>();
  for (const [k, v] of registered) {
    if (k.startsWith("tool/")) m.set(k.slice(5), v as AgentTool);
  }
  return m;
}

describe("registerRealTools（3-1 工具插件化）", () => {
  it("注册 7 个真实工具（无 echo），risk 标注正确", () => {
    const { ctx, registered } = makeCtx({});
    registerRealTools(ctx);
    const tools = toolsOf(registered);
    expect([...tools.keys()].sort()).toEqual([
      "list_dir",
      "list_sessions",
      "load_session",
      "read_file",
      "render_markdown",
      "save_session",
      "write_file",
    ]);
    expect(tools.has("echo")).toBe(false);
    expect(tools.get("read_file")?.risk).toBe("read");
    expect(tools.get("write_file")?.risk).toBe("write");
    expect(tools.get("save_session")?.risk).toBe("write");
    expect(tools.get("list_dir")?.risk).toBe("read");
  });

  it("read_file / list_dir 正常执行；list_dir 缺省 path 用根目录", async () => {
    const { ctx, registered } = makeCtx({
      fs: {
        readDir: async (p) =>
          p === "" ? [{ name: "a.md", path: "a.md", isDirectory: false }] : [{ name: "b", path: "b", isDirectory: true }],
      },
    });
    registerRealTools(ctx);
    const tools = toolsOf(registered);
    expect(await tools.get("read_file")!.execute({ path: "笔记.md" })).toBe("内容:笔记.md");
    expect(await tools.get("list_dir")!.execute({})).toBe("a.md"); // 缺省 "" → 根目录
    expect(await tools.get("list_dir")!.execute({ path: "sub" })).toBe("[目录] b");
  });

  it("write_file 写入并返回提示；save_session 构造 SessionLike 调 store.saveSession", async () => {
    const written: Array<[string, string]> = [];
    const { ctx, registered, saves } = makeCtx({
      fs: { writeFile: async (p, c) => void written.push([p, c]) },
    });
    registerRealTools(ctx);
    const tools = toolsOf(registered);
    expect(await tools.get("write_file")!.execute({ path: "a.md", content: "hello" })).toBe("已写入 a.md");
    expect(written).toEqual([["a.md", "hello"]]);
    expect(await tools.get("write_file")!.execute({ content: "x" })).toBe("Error: 缺少 path 参数");

    const ret = await tools.get("save_session")!.execute({ title: "论文总结", content: "核心结论…" });
    expect(ret).toContain("论文总结");
    expect(saves).toHaveLength(1);
    const s = saves[0] as { meta: { type: string; title: string }; nodes: unknown[]; links: unknown[] };
    expect(s.meta.type).toBe("chat");
    expect(s.meta.title).toBe("论文总结");
    expect(s.nodes).toHaveLength(1);
    expect((s.nodes[0] as { kind: string }).kind).toBe("user");
    expect(s.links).toEqual([]);
  });

  it("list_sessions / load_session / render_markdown 正常执行；会话不存在报错", async () => {
    const { ctx, registered } = makeCtx({
      store: {
        listSessions: async () => [{ id: "s1", title: "会话1", nodeCount: 3 }],
        loadSession: async (id: string) => (id === "s1" ? { meta: { id: "s1", title: "会话1" }, nodes: [{ kind: "assistant", content: "答" }] } : undefined),
      },
    });
    registerRealTools(ctx);
    const tools = toolsOf(registered);
    expect(await tools.get("list_sessions")!.execute({})).toBe("s1\t会话1\t3 消息");
    expect(await tools.get("load_session")!.execute({ id: "s1" })).toContain("会话1");
    expect(await tools.get("load_session")!.execute({ id: "nope" })).toContain("会话不存在");
    expect(await tools.get("render_markdown")!.execute({ src: "**x**" })).toBe("<p>**x**</p>");
  });

  it("无根目录（readFile 抛「尚未打开文件夹」）→ execute 抛错不崩（agent loop 会包成 Error 文本）", async () => {
    const { ctx, registered } = makeCtx({
      fs: { readFile: async () => Promise.reject(new Error("尚未打开文件夹")) },
    });
    registerRealTools(ctx);
    await expect(toolsOf(registered).get("read_file")!.execute({ path: "a.md" })).rejects.toThrow(/尚未打开文件夹/);
  });

  it("空目录 / 空会话列表 → 友好占位文本", async () => {
    const { ctx, registered } = makeCtx({});
    registerRealTools(ctx);
    const tools = toolsOf(registered);
    expect(await tools.get("list_dir")!.execute({})).toBe("（空目录）");
    expect(await tools.get("list_sessions")!.execute({})).toBe("（暂无会话）");
  });
});
