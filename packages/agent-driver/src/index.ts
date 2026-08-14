import type { DriverContext } from "@minex/kernel";
import type { ChatMessage, LLMMetricsEntry, LLMPrices, LLMProvider } from "minex-llm-driver";
import { runAgent } from "./agent.js";
import { onEnvelope, parseEnvelope, sendEnvelope, serializeEnvelope, type Envelope } from "./envelope.js";
import { executeWorkflow } from "./interpreter.js";
import { createBuiltinRegistry } from "./operations.js";
import { createPool } from "./pool.js";
import { echoTool, type AgentTool } from "./tool.js";
import { validateWorkflow, type Workflow } from "./workflow.js";

/** llm.config 结构类型子集（agent 用到的部分） */
interface ConfigLike {
  getModel(): string;
  getPrices(): Record<string, LLMPrices>;
}

/** llm.metrics 结构类型子集 */
interface MetricsLike {
  record(entry: LLMMetricsEntry): void;
}

/**
 * Agent 驱动（id: minex.agent）。
 * 注册示例工具 `echo` + `agent` 能力（run：ReAct loop，串行工具执行）。
 * 依赖 minex.llm（llm / llm.config / llm.metrics / tool）。
 */
export default {
  async activate(ctx: DriverContext) {
    // 示例工具（后续接 filesystem 等真实工具）
    ctx.register("tool", "echo", echoTool);

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

    // agent 能力：从内核收集依赖 → runAgent（opts.onContext 透传，2-4 大纲记忆加工 hook）
    ctx.register("agent", "default", {
      run(
        systemPrompt: string,
        history: ChatMessage[],
        maxIterations?: number,
        opts?: { onContext?: (contextItems: Array<{ ref: string; content: string }>) => void },
      ) {
        const provider = ctx.get<LLMProvider>("llm", "deepseek");
        if (!provider) throw new Error("未找到 llm 能力（deepseek）");
        const config = ctx.get<ConfigLike>("llm.config", "default");
        const metrics = ctx.get<MetricsLike>("llm.metrics", "default");
        const tools = ctx.query<AgentTool>("tool");
        const model = config?.getModel() || "deepseek-chat";
        const prices = config?.getPrices()[model] ?? { inputHit: 0, inputMiss: 0, output: 0 };

        return runAgent(
          {
            stream: (req) => provider.stream(req),
            tools,
            model,
            recordMetrics: (entry) => metrics?.record(entry),
            prices,
          },
          { systemPrompt, history, maxIterations, ...(opts ? { onContext: opts.onContext } : {}) },
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

    return () => {};
  },
};
