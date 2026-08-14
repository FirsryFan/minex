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
              ? { onContext: opts.onContext, ...(opts.canRun ? { canRun: opts.canRun } : {}) }
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

    // 内置 persona（P1）：注册为 role 贡献，浮窗选择器 / agent 自主候选池（autoAdopt 阶段 3）消费
    for (const p of BUILTIN_PERSONAS) {
      ctx.register("role", p.id, p);
    }

    return () => {};
  },
};
