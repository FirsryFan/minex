/** Agent 工具（S5d）：工具 = 名称 + 描述 + 参数 schema + 执行函数。 */
/** risk（3-1 工具插件化 / 3-2 权限）：read 只读 / write 写 / run 执行；旧工具缺省视为 read（不改旧引用） */
export type ToolRisk = "read" | "write" | "run";

export interface AgentTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  /** 权限风险级别（3-2 权限模式裁决用；缺省按 read 处理，兼容旧工具/测试直引） */
  risk?: ToolRisk;
  execute(args: Record<string, unknown>): Promise<string>;
}

/** 示例工具 echo：返回原文本（验证 loop 用，保留导出供测试直引；index.ts 不再注册）。 */
export const echoTool: AgentTool = {
  name: "echo",
  description: "回显传入的文本（示例工具）",
  parameters: {
    type: "object",
    properties: { text: { type: "string", description: "要回显的文本" } },
    required: ["text"],
  },
  risk: "read",
  async execute(args) {
    return String(args.text ?? "");
  },
};
