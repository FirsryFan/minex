/**
 * 3-2 权限模式三档（Q2 定案）：工具执行前按模式裁决。
 * - auto：完全自由（全部 allow）
 * - edit：自由编辑（read/write allow；run 需许可）
 * - manual：写入和运行需要许可（read allow；write/run ask）
 * 按工具覆盖优先（toolPermissions[name]）；模式插件化声明：裁决器可扩展为
 * ctx.register("permission", modeId, { check })——v1 内置三档常量，注册留位。
 */
export type PermissionMode = "auto" | "edit" | "manual";

export type ToolRisk = "read" | "write" | "run";

/** 内置三档（UI 下拉 / 模式插件化留位的 v1 常量集） */
export const PERMISSION_MODES: PermissionMode[] = ["auto", "edit", "manual"];

export interface PermissionTool {
  name: string;
  risk: ToolRisk;
}

export type PermissionVerdict = "allow" | "ask";

/**
 * 权限裁决：overrides[tool.name] 优先，否则按 mode。
 * 纯函数可测（三档 × read/write/run + 覆盖 + 缺省）。
 */
export function checkPermission(
  tool: PermissionTool,
  mode: PermissionMode,
  overrides?: Record<string, PermissionMode>,
): PermissionVerdict {
  const effective = overrides?.[tool.name] ?? mode;
  if (effective === "auto") return "allow";
  if (effective === "manual") return tool.risk === "read" ? "allow" : "ask";
  // edit：read/write 自由，run 需许可
  return tool.risk === "run" ? "ask" : "allow";
}
