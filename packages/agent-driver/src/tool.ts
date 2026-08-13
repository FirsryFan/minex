/** Agent 工具（S5d）：工具 = 名称 + 描述 + 参数 schema + 执行函数。 */

export interface AgentTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute(args: Record<string, unknown>): Promise<string>;
}

/** 示例工具 echo：返回原文本（验证 loop 用，后续接 filesystem 等真实工具）。 */
export const echoTool: AgentTool = {
  name: "echo",
  description: "回显传入的文本（示例工具）",
  parameters: {
    type: "object",
    properties: { text: { type: "string", description: "要回显的文本" } },
    required: ["text"],
  },
  async execute(args) {
    return String(args.text ?? "");
  },
};
