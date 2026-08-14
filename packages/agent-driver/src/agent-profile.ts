/**
 * AgentProfile 数据模型（F-C 反馈 1/2 + F-D 反馈 3，定案 §一）：
 * agent 档案 = agent 级默认设置（persona 是其中一部分：profile.personaId 内嵌引用）。
 * 消费优先级（chat-view）：会话级 settings > profile > persona > 全局默认（agentConfig）。
 * 存储：内核 storage `minex.agent/agentProfiles`（Record<id, AgentProfile>，load 损坏容错返回 {}）。
 */
import type { ChatHistoryKernel } from "./chat-history.js";

export interface AgentProfile {
  id: string; // 唯一，如 "agent.study-tutor"
  name: string; // 显示名（侧栏列表 / 过滤下拉）
  avatar?: string; // 头像（v1 = emoji/首字，无图片上传）
  description?: string;
  personaId?: string; // 内嵌 persona 引用（persona 是 agent 设置的一部分）
  systemPrompt?: string; // 覆盖 persona.systemPrompt（缺省 = persona 的）
  tools?: string[] | null; // 工具白名单（null = 全部；覆盖 persona.tools）
  skills?: string[]; // skill 集（v1 = 内置 skill 常量 id 列表）
  memory?: { outlines?: boolean }; // 记忆模块（v1：大纲记忆开关，缺省开）
  model?: string; // 模型（缺省 = 全局）
  permissionMode?: "auto" | "edit" | "manual"; // 模式（缺省 = agentConfig.defaultPermissionMode）
  params?: Record<string, unknown>; // 模型参数（temperature 等）
  filePool?: string[]; // 专属文件池（相对根目录路径列表）
  slots?: Record<string, unknown>; // 代码插槽（v1：{ code?: string }，F-D 预览写入）
}

/** 内置 skill（F-D 反馈 3，Harness skill 角色包概念映射）——每 skill 是提示词片段，经 systemPrompt 拼接消费 */
export interface AgentSkill {
  id: string;
  name: string;
  description: string;
  promptBlock: string;
}

export const BUILTIN_SKILLS: AgentSkill[] = [
  {
    id: "skill.structured",
    name: "结构化输出",
    description: "回答按固定结构（分点/表格/章节）输出",
    promptBlock: "输出请使用结构化格式（分点、表格或明确的章节标题），便于阅读与复用。",
  },
  {
    id: "skill.stepwise",
    name: "分步推理",
    description: "复杂问题先拆解步骤再逐步求解",
    promptBlock: "面对复杂问题，请先拆解为若干步骤，逐步推理并说明每一步的依据。",
  },
  {
    id: "skill.code-review",
    name: "代码审查",
    description: "审查代码时关注正确性/可读性/安全性",
    promptBlock: "审查代码时请从正确性、可读性、可维护性与安全性四个维度给出意见。",
  },
];

/**
 * 校验 AgentProfile（F-C，纯函数）：骨架必填（id/name）缺一 false；
 * 可选字段形状校验（tools 数组或 null、skills/filePool 数组、memory 形状、permissionMode 枚举）；
 * params/slots 为 payload 类字段，任意形状可存。
 */
export function validateAgentProfile(data: unknown): data is AgentProfile {
  if (typeof data !== "object" || data === null) return false;
  const p = data as Record<string, unknown>;
  if (typeof p.id !== "string" || typeof p.name !== "string") return false;
  if (p.avatar !== undefined && typeof p.avatar !== "string") return false;
  if (p.description !== undefined && typeof p.description !== "string") return false;
  if (p.personaId !== undefined && typeof p.personaId !== "string") return false;
  if (p.systemPrompt !== undefined && typeof p.systemPrompt !== "string") return false;
  if (
    p.tools !== undefined &&
    p.tools !== null &&
    (!Array.isArray(p.tools) || (p.tools as unknown[]).some((t) => typeof t !== "string"))
  ) {
    return false;
  }
  if (p.skills !== undefined && (!Array.isArray(p.skills) || (p.skills as unknown[]).some((s) => typeof s !== "string"))) {
    return false;
  }
  if (p.memory !== undefined) {
    if (typeof p.memory !== "object" || p.memory === null) return false;
    const m = p.memory as Record<string, unknown>;
    if (m.outlines !== undefined && typeof m.outlines !== "boolean") return false;
  }
  if (p.model !== undefined && typeof p.model !== "string") return false;
  if (
    p.permissionMode !== undefined &&
    p.permissionMode !== "auto" &&
    p.permissionMode !== "edit" &&
    p.permissionMode !== "manual"
  ) {
    return false;
  }
  if (
    p.filePool !== undefined &&
    (!Array.isArray(p.filePool) || (p.filePool as unknown[]).some((f) => typeof f !== "string"))
  ) {
    return false;
  }
  return true; // params / slots payload 自由
}

/** 读取全部 profile：JSON 损坏/非对象 → {}；非法条目跳过（容错）。 */
export function loadAgentProfiles(kernel: ChatHistoryKernel): Record<string, AgentProfile> {
  try {
    const raw = kernel.storage.namespace("minex.agent").get<Record<string, unknown>>("agentProfiles");
    if (!raw || typeof raw !== "object") return {};
    const out: Record<string, AgentProfile> = {};
    for (const [id, v] of Object.entries(raw)) {
      if (validateAgentProfile(v)) out[id] = v as AgentProfile;
    }
    return out;
  } catch {
    return {};
  }
}

/** 保存单个 profile（按 id 合并写）；损坏的其余条目保留。 */
export function saveAgentProfile(kernel: ChatHistoryKernel, profile: AgentProfile): void {
  const all = loadAgentProfiles(kernel);
  all[profile.id] = profile;
  kernel.storage.namespace("minex.agent").set("agentProfiles", all);
}

/** 删除 profile。 */
export function deleteAgentProfile(kernel: ChatHistoryKernel, id: string): void {
  const all = loadAgentProfiles(kernel);
  delete all[id];
  kernel.storage.namespace("minex.agent").set("agentProfiles", all);
}
