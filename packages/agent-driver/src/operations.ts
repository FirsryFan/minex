import type { DriverContext } from "@minex/kernel";
import type { AgentTool } from "./tool.js";

/** 操作函数：args 为节点参数，ctx 为解释器上下文（能力桥接用） */
export type OperationFn = (args: Record<string, unknown>, ctx: unknown) => Promise<unknown>;

export interface OperationRegistry {
  register(name: string, fn: OperationFn): void;
  has(name: string): boolean;
  execute(name: string, args: Record<string, unknown>, ctx: unknown): Promise<unknown>;
}

/** 空注册表（白名单机制核心：只查表调用，无任意代码路径） */
export function createRegistry(): OperationRegistry {
  const fns = new Map<string, OperationFn>();
  return {
    register(name, fn) {
      fns.set(name, fn);
    },
    has(name) {
      return fns.has(name);
    },
    async execute(name, args, ctx) {
      const fn = fns.get(name);
      if (!fn) throw new Error(`未注册操作：${name}`);
      return fn(args, ctx);
    },
  };
}

/**
 * 内置操作注册表：桥接已注册能力，能力未就绪则跳过。
 * - callTool（tool 能力）/ readSession / writeSession（session）/ sendEnvelope（envelope）
 * - readPool / requestPoolWrite（pool）/ localVar（解释器内建存储）
 */
export function createBuiltinRegistry(ctx: DriverContext): OperationRegistry {
  const registry = createRegistry();
  const localVars = new Map<string, unknown>();

  // callTool：查 tool 能力
  const tools = ctx.query<AgentTool>("tool");
  if (tools.length > 0) {
    registry.register("callTool", async (args) => {
      const name = String(args.name ?? "");
      const tool = tools.find((t) => t.name === name);
      if (!tool) throw new Error(`未找到工具：${name}`);
      return tool.execute((args.args ?? {}) as Record<string, unknown>);
    });
  }

  // sendEnvelope：查 envelope 能力（from/to/type 必填）
  const envelope = ctx.get<{ send(env: unknown): void }>("envelope", "default");
  if (envelope) {
    registry.register("sendEnvelope", async (args) => {
      const from = args.from;
      const to = args.to;
      const type = args.type;
      if (typeof from !== "string" || typeof to !== "string" || typeof type !== "string") {
        throw new Error("sendEnvelope 需要 from/to/type 必填");
      }
      envelope.send(args);
      return undefined;
    });
  }

  // readPool / requestPoolWrite：查 pool 能力
  const pool = ctx.get<{ read(key: string): unknown }>("pool", "default");
  if (pool) {
    registry.register("readPool", async (args) => pool.read(String(args.key ?? "")));
  }

  // requestPoolWrite：发 pool-request 信封（写池是 manager 编排层特权，白名单不含直接写）
  if (envelope) {
    registry.register("requestPoolWrite", async (args) => {
      const from = args.from;
      const to = args.to ?? "manager";
      if (typeof from !== "string") throw new Error("requestPoolWrite 需要 from 必填");
      envelope.send({
        from,
        to,
        type: "pool-request",
        payload: { key: args.key, value: args.value },
      });
      return undefined;
    });
  }

  // readSession / writeSession：查 session 能力
  const session = ctx.get<{ loadSession(id: string): Promise<unknown>; saveSession(s: unknown): Promise<void> }>("session", "default");
  if (session) {
    registry.register("readSession", async (args) => session.loadSession(String(args.id ?? "")));
    registry.register("writeSession", async (args) => {
      await session.saveSession(args.session);
      return undefined;
    });
  }

  // localVar：解释器内建存储（跨节点共享）
  registry.register("localVar", async (args) => {
    const op = String(args.op ?? "get");
    const key = String(args.key ?? "");
    if (op === "get") return localVars.get(key);
    if (op === "set") {
      localVars.set(key, args.value);
      return args.value;
    }
    throw new Error(`localVar 未知操作：${op}`);
  });

  return registry;
}
