import type { DriverContext } from "@minex/kernel";
import type { ChatMessage, LLMMetricsEntry, LLMPrices, LLMProvider } from "minex-llm-driver";
import { runAgent } from "./agent.js";
import { onEnvelope, parseEnvelope, sendEnvelope, serializeEnvelope, type Envelope } from "./envelope.js";
import { executeWorkflow } from "./interpreter.js";
import { createBuiltinRegistry } from "./operations.js";
import { createPool } from "./pool.js";
import type { AgentTool } from "./tool.js";
import { validateWorkflow, type Workflow } from "./workflow.js";
import { BUILTIN_PERSONAS } from "./persona.js";
import { registerRealTools } from "./real-tools.js";
import { BUILTIN_SKILLS, deleteAgentProfile, loadAgentProfiles, saveAgentProfile } from "./agent-profile.js";

/** llm.config 结构类型子集（agent 用到的部分） */
interface ConfigLike {
  getModel(): string;
  getParams(): Record<string, unknown>;
  getPrices(): Record<string, LLMPrices>;
}

/** llm.metrics 结构类型子集 */
interface MetricsLike {
  record(entry: LLMMetricsEntry): void;
}

/** agent.run 的 opts（3-1 toolWhitelist / 3-2 canRun / 3-3 model+params；后续 task 扩展） */
interface RunOpts {
  onContext?: (contextItems: Array<{ ref: string; content: string }>) => void;
  /** 工具白名单（persona.tools 消费；缺省 = 全部工具） */
  toolWhitelist?: string[];
  /** 权限裁决 hook（3-2）：每个工具调用执行前调用；false → 拒绝文本回灌 */
  canRun?: (call: { name: string; risk: string }) => Promise<boolean>;
  /** 3-3：模型名覆盖（会话级 settings.model；缺省 = llm.config.getModel() 或 deepseek-chat） */
  model?: string;
  /** 3-3：模型参数覆盖（会话级 temperature 等；与 llm.config.getParams() 合并，本值优先） */
  params?: Record<string, unknown>;
  /** 3-4：真停止（AbortController 全链透传） */
  signal?: AbortSignal;
  /** 3-4：插入指令（每轮 buildMessages 前读取；读后清空） */
  pendingMessages?: () => ChatMessage[];
}

/**
 * Agent 驱动（id: minex.agent）。
 * 注册 7 个真实工具（real-tools）+ `agent` 能力（run：ReAct loop，串行工具执行）。
 * 依赖 minex.llm / mist.session / minex.filesystem / minex.markdown（manifest dependencies）。
 */
export default {
  async activate(ctx: DriverContext) {
    // 3-1 工具插件化：注册 7 个真实工具（read_file/list_dir/write_file/render_markdown/list_sessions/load_session/save_session）
    registerRealTools(ctx);

    // 3-5：graph_query 工具（Graph↔agent）——取 graphSource 数据 → translateGraph 转译文本（agent 读图）
    const graphCap = ctx.get<{ translateGraph(data: { nodes: unknown[]; edges: unknown[] }): string }>("graph", "default");
    if (graphCap) {
      ctx.register("tool", "graph_query", {
        name: "graph_query",
        description:
          "查询图谱数据（会话树 / 工作流等 graphSource 数据源），返回可读文本。source 参数 = 数据源标题（缺省第一个）。",
        parameters: {
          type: "object",
          properties: { source: { type: "string", description: "数据源标题，如 会话树 / 工作流（缺省第一个）" } },
        },
        risk: "read",
        async execute(args: Record<string, unknown>) {
          const sources = ctx.query<{
            title: string;
            getData(): Promise<{ nodes: unknown[]; edges: unknown[] }>;
          }>("graphSource");
          const wanted = typeof args.source === "string" ? args.source : "";
          const src = sources.find((s) => s.title === wanted) ?? sources[0];
          if (!src) return "Error: 无可用图谱数据源";
          const data = await src.getData();
          return graphCap.translateGraph(data as never);
        },
      });
    }

    // 3-5：workflow 执行方法图数据源（Graph↔agent）——workflow 结构 → 步骤图（nodes→步骤节点、deps→边）
    // v1：示例 workflow（无 workflow 存储库；阶段 4 接真实 workflow 数据）
    ctx.register("graphSource", "workflow", {
      title: "工作流",
      getData: async () => {
        const sample: Workflow = {
          nodes: [
            { id: "start", op: "echo", args: { text: "开始" } },
            { id: "mid", op: "echo", args: { text: "处理" }, deps: ["start"] },
            { id: "end", op: "echo", args: { text: "结束" }, deps: ["mid"] },
          ],
        };
        return {
          nodes: sample.nodes.map((n) => ({
            id: n.id,
            label: `${n.id}（${n.op}）`,
            group: "步骤",
            meta: { op: n.op },
          })),
          edges: sample.nodes.flatMap((n) => (n.deps ?? []).map((d) => ({ from: d, to: n.id }))),
        };
      },
    });

    // 协议信封能力（parse/serialize/send/on，纯数据层）
    ctx.register("envelope", "default", {
      parse: parseEnvelope,
      serialize: serializeEnvelope,
      send: (env: Envelope) => sendEnvelope(ctx, env),
      on: (to: string, cb: (env: Envelope) => void) => onEnvelope(ctx, to, cb),
    });

    // 消息池能力（manager 独占写；expert 申请→批准→写）
    ctx.register("pool", "default", createPool(ctx.storage, ctx));

    // 代码插槽（S5g 接线）：白名单操作注册表 + workflow 解释执行能力
    const registry = createBuiltinRegistry(ctx);
    ctx.register("workflow", "default", {
      run(wf: Workflow, opts?: { maxLoopIterations?: number }) {
        const maxLoopIterations = opts?.maxLoopIterations ?? 100;
        validateWorkflow(wf, registry, { maxLoopIterations });
        return executeWorkflow(wf, ctx, { registry, maxLoopIterations });
      },
    });

    // agent 能力：从内核收集依赖 → runAgent（opts.onContext 透传，2-4 大纲记忆加工 hook；
    // 3-1 toolWhitelist 按 persona.tools 白名单过滤工具，缺省 = 全部）
    ctx.register("agent", "default", {
      run(
        systemPrompt: string,
        history: ChatMessage[],
        maxIterations?: number,
        opts?: RunOpts,
      ) {
        const provider = ctx.get<LLMProvider>("llm", "deepseek");
        if (!provider) throw new Error("未找到 llm 能力（deepseek）");
        const config = ctx.get<ConfigLike>("llm.config", "default");
        const metrics = ctx.get<MetricsLike>("llm.metrics", "default");
        const allTools = ctx.query<AgentTool>("tool");
        const whitelist = opts?.toolWhitelist;
        const tools =
          whitelist && whitelist.length > 0 ? allTools.filter((t) => whitelist.includes(t.name)) : allTools;
        // 3-3：模型 = 会话级覆盖 ?? 全局配置 ?? 默认；params = 全局默认 + 会话级覆盖
        const model = opts?.model ?? (config?.getModel() || "deepseek-chat");
        const defaultParams = config?.getParams() ?? {};
        const params = { ...defaultParams, ...(opts?.params ?? {}) };
        const prices = config?.getPrices()[model] ?? { inputHit: 0, inputMiss: 0, output: 0 };

        return runAgent(
          {
            stream: (req) => provider.stream(req),
            tools,
            model,
            recordMetrics: (entry) => metrics?.record(entry),
            prices,
          },
          {
            systemPrompt,
            history,
            maxIterations,
            params,
            ...(opts
              ? {
                  onContext: opts.onContext,
                  ...(opts.canRun ? { canRun: opts.canRun } : {}),
                  ...(opts.signal ? { signal: opts.signal } : {}),
                  ...(opts.pendingMessages ? { pendingMessages: opts.pendingMessages } : {}),
                }
              : {}),
          },
        );
      },
    });

    // 聊天面板：顶栏选 Agent → 主区聊天界面（惰性加载，Node 宿主不触发）
    ctx.register("panel", "minex.agent.chat", {
      driverId: "minex.agent",
      id: "minex.agent.chat",
      title: "聊天",
      defaultDock: "main",
      load: () => import("./chat-view.js"),
    });

    // F-A 反馈 4：Agent 配置面板（persona 画廊 + 工具白名单 + 默认权限模式 + 默认 systemPrompt）
    ctx.register("panel", "minex.agent.config", {
      driverId: "minex.agent",
      id: "minex.agent.config",
      title: "Agent",
      defaultDock: "left",
      load: () => import("./config-view.js"),
    });

    // 内置 persona（P1）：注册为 role 贡献，浮窗选择器 / agent 自主候选池（autoAdopt 阶段 3）消费
    for (const p of BUILTIN_PERSONAS) {
      ctx.register("role", p.id, p);
    }

    // F-C：agent 档案能力（跨包消费桥接——overview 过滤/设置下拉经此读 profile，零源码 import）
    ctx.register("agent.profile", "default", {
      loadAgentProfiles,
      saveAgentProfile,
      deleteAgentProfile,
      BUILTIN_SKILLS,
    });

    return () => {};
  },
};
