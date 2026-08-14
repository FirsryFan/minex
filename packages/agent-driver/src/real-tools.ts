/**
 * 真实工具注册（task 3-1 工具插件化）：7 个真实工具。
 * 能力经 DriverContext.get 结构类型子集获取（跨包零源码 import，无 .value——驱动内 ctx.get 已解包）。
 * 工具 = registry 贡献（ctx.register("tool", ...)），任何驱动可增删（harness 插件哲学）；
 * persona.tools 白名单在 index.ts run() 收集处按名过滤（缺省 = 全部）。
 * risk 标注（3-2 权限模式用）：read 只读 / write 写 / run 执行。
 */
import type { DriverContext } from "@minex/kernel";
import type { AgentTool } from "./tool.js";

/** filesystem 能力子集（结构类型） */
interface FsLike {
  hasRoot(): boolean;
  readDir(path: string): Promise<Array<{ name: string; path: string; isDirectory: boolean }>>;
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
}

/** session 能力子集（结构类型） */
interface SessionStoreLike {
  hasRoot(): boolean;
  listSessions(): Promise<Array<{ id: string; title: string; nodeCount: number }>>;
  loadSession(id: string): Promise<unknown>;
  saveSession(s: unknown): Promise<void>;
}

/** markdown 能力子集（结构类型） */
interface MarkdownLike {
  render(src: string): string;
}

function randomId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `s-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/** 注册 7 个真实工具（中文描述 + JSON schema + risk）。依赖缺失时不注册对应工具（能力桥接防御）。 */
export function registerRealTools(ctx: DriverContext): void {
  const fs = ctx.get<FsLike>("filesystem", "default");
  const store = ctx.get<SessionStoreLike>("session", "default");
  const md = ctx.get<MarkdownLike>("markdown", "render");

  const tools: AgentTool[] = [];

  if (fs) {
    tools.push(
      {
        name: "read_file",
        description: "读取文件内容（相对根目录路径）。",
        parameters: {
          type: "object",
          properties: { path: { type: "string", description: "文件路径，如 笔记.md" } },
          required: ["path"],
        },
        risk: "read",
        async execute(args) {
          return fs.readFile(str(args.path));
        },
      },
      {
        name: "list_dir",
        description: "列出目录内容（相对根目录路径；缺省根目录）。",
        parameters: {
          type: "object",
          properties: { path: { type: "string", description: "目录路径，缺省为根目录" } },
        },
        risk: "read",
        async execute(args) {
          const entries = await fs.readDir(str(args.path));
          if (entries.length === 0) return "（空目录）";
          return entries.map((e) => `${e.isDirectory ? "[目录] " : ""}${e.path}`).join("\n");
        },
      },
      {
        name: "write_file",
        description: "写入文件内容（覆盖；相对根目录路径，深层目录自动创建）。",
        parameters: {
          type: "object",
          properties: {
            path: { type: "string", description: "文件路径，如 笔记.md" },
            content: { type: "string", description: "要写入的内容" },
          },
          required: ["path", "content"],
        },
        risk: "write",
        async execute(args) {
          const path = str(args.path);
          if (!path) return "Error: 缺少 path 参数";
          await fs.writeFile(path, str(args.content));
          return `已写入 ${path}`;
        },
      },
    );
  }

  if (md) {
    tools.push({
      name: "render_markdown",
      description: "把 markdown 源码渲染为 HTML（查看渲染效果用）。",
      parameters: {
        type: "object",
        properties: { src: { type: "string", description: "markdown 源码" } },
        required: ["src"],
      },
      risk: "read",
      async execute(args) {
        return md.render(str(args.src));
      },
    });
  }

  if (store) {
    tools.push(
      {
        name: "list_sessions",
        description: "列出全部会话（id + 标题 + 消息数）。",
        parameters: { type: "object", properties: {} },
        risk: "read",
        async execute() {
          const list = await store.listSessions();
          if (list.length === 0) return "（暂无会话）";
          return list.map((e) => `${e.id}\t${e.title}\t${e.nodeCount} 消息`).join("\n");
        },
      },
      {
        name: "load_session",
        description: "读取会话内容摘要（id + 标题 + 节点列表）。",
        parameters: {
          type: "object",
          properties: { id: { type: "string", description: "会话 id" } },
          required: ["id"],
        },
        risk: "read",
        async execute(args) {
          const s = (await store.loadSession(str(args.id))) as
            | { meta?: { id?: string; title?: string }; nodes?: Array<{ kind?: string; content?: string; toolName?: string }> }
            | undefined;
          if (!s) return "Error: 会话不存在";
          const nodes = (s.nodes ?? []).map((n) => `- ${n.kind ?? "?"}: ${n.content ?? n.toolName ?? ""}`);
          return `# ${s.meta?.title ?? s.meta?.id ?? "?"}\n${nodes.join("\n")}`;
        },
      },
      {
        name: "save_session",
        description: "把一段内容保存为新会话（标题 + 内容，首条消息为用户消息）。",
        parameters: {
          type: "object",
          properties: {
            title: { type: "string", description: "会话标题" },
            content: { type: "string", description: "会话首条内容" },
          },
          required: ["title", "content"],
        },
        risk: "write",
        async execute(args) {
          const title = str(args.title) || "新会话";
          const now = new Date().toISOString();
          const session = {
            meta: { id: randomId(), type: "chat", title, tags: [], createdAt: now, updatedAt: now },
            activeAgents: [],
            nodes: [{ id: randomId(), kind: "user", content: str(args.content), ts: now }],
            links: [],
          };
          await store.saveSession(session);
          return `已保存会话「${title}」`;
        },
      },
    );
  }

  for (const t of tools) {
    ctx.register("tool", t.name, t);
  }
}
