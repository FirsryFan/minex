/**
 * persona 数据模型（task 2-1 修订版，P1 拍板）：
 * 「设定好的 agent」= persona + 专属插槽代码；经 `role` 贡献注册，会话 meta.personaId 关联，子会话继承。
 * v1：UI 显式选择（2-R1 浮窗选择器）；autoAdopt 字段与注入位留好，adoptPersona 工具留阶段 3。
 */

/** 设定好的 agent 角色（skill 角色包：systemPrompt + 工具集 + 行为约束打包单元） */
export interface Persona {
  /** 全局唯一 id，如 "minex.persona.researcher" */
  id: string;
  /** 显示名（浮窗选择器显示） */
  name: string;
  /** 一句话说明（agent 自主选用时它"读"的就是这个） */
  description?: string;
  /** 角色 system prompt（注入 agent.run 的 systemPrompt） */
  systemPrompt: string;
  /** 工具白名单（缺省 = 全部；阶段 3 接真实工具时生效） */
  tools?: string[];
  /** true = 进入「agent 自主候选池」（v1 只留字段，adoptPersona 工具留阶段 3） */
  autoAdopt?: boolean;
  /** 专属插槽代码（受限 DSL/workflow 代码，v1 可先存不用） */
  slots?: Record<string, unknown>;
}

/**
 * 校验 persona：骨架必填（id/name/systemPrompt）缺一 false；
 * description/tools/autoAdopt 出现时做形状校验；slots 为 payload 类字段，自由。
 */
export function validatePersona(data: unknown): data is Persona {
  if (typeof data !== "object" || data === null) return false;
  const p = data as Record<string, unknown>;
  if (typeof p.id !== "string" || typeof p.name !== "string" || typeof p.systemPrompt !== "string") return false;
  if (p.description !== undefined && typeof p.description !== "string") return false;
  if (
    p.tools !== undefined &&
    (!Array.isArray(p.tools) || (p.tools as unknown[]).some((t) => typeof t !== "string"))
  ) {
    return false;
  }
  if (p.autoAdopt !== undefined && typeof p.autoAdopt !== "boolean") return false;
  return true; // slots 自由（payload 类字段，任意形状可存）
}
