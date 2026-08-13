import type { DriverManifest } from "./types.js";

/**
 * 驱动 id 校验：点号分隔的段，每段以字母数字开头、可含字母数字/下划线/连字符。
 * 拒绝空段、首尾分隔符、连续分隔符（".."、"-x"、"a."、"a..b" 均非法）。
 */
function isValidId(id: string): boolean {
  return id.split(".").every((seg) => /^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(seg));
}

/** 解析并校验 manifest。非法输入抛带明确信息的错误（错误早暴露）。 */
export function parseManifest(raw: unknown): DriverManifest {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`Manifest: must be a JSON object`);
  }
  const m = raw as Record<string, unknown>;

  if (typeof m.id !== "string" || !isValidId(m.id)) {
    throw new Error(
      `Manifest: "id" must be dotted-segments each starting with an alphanumeric (got ${JSON.stringify(m.id)})`,
    );
  }
  if (typeof m.name !== "string" || !m.name) {
    throw new Error(`Manifest: "name" must be a non-empty string (driver "${m.id ?? "?"}")`);
  }
  if (m.icon !== undefined && typeof m.icon !== "string") {
    throw new Error(`Manifest: "icon" must be a string (driver "${m.id}")`);
  }
  if (m.hasWorkspace !== undefined && typeof m.hasWorkspace !== "boolean") {
    throw new Error(`Manifest: "hasWorkspace" must be a boolean (driver "${m.id}")`);
  }
  if (m.source !== undefined && typeof m.source !== "string") {
    throw new Error(`Manifest: "source" must be a string (driver "${m.id}")`);
  }
  if (m.description !== undefined && typeof m.description !== "string") {
    throw new Error(`Manifest: "description" must be a string (driver "${m.id}")`);
  }
  if (typeof m.version !== "string" || !m.version) {
    throw new Error(`Manifest: "version" must be a non-empty string (driver "${m.id ?? "?"}")`);
  }
  if (m.minKernelVersion !== undefined && typeof m.minKernelVersion !== "string") {
    throw new Error(`Manifest: "minKernelVersion" must be a string (driver "${m.id}")`);
  }
  if (
    m.dependencies !== undefined &&
    !(Array.isArray(m.dependencies) && m.dependencies.every((d) => typeof d === "string"))
  ) {
    throw new Error(`Manifest: "dependencies" must be an array of strings (driver "${m.id}")`);
  }
  if (m.tags !== undefined && !(Array.isArray(m.tags) && m.tags.every((t) => typeof t === "string"))) {
    throw new Error(`Manifest: "tags" must be an array of strings (driver "${m.id}")`);
  }
  if (m.kind !== undefined && typeof m.kind !== "string") {
    throw new Error(`Manifest: "kind" must be a string (driver "${m.id}")`);
  }
  if (
    m.settingsSchema !== undefined &&
    (typeof m.settingsSchema !== "object" || m.settingsSchema === null || Array.isArray(m.settingsSchema))
  ) {
    throw new Error(`Manifest: "settingsSchema" must be an object (driver "${m.id}")`);
  }
  if (m.reloadable !== undefined && typeof m.reloadable !== "boolean") {
    throw new Error(`Manifest: "reloadable" must be a boolean (driver "${m.id}")`);
  }
  if (
    m.contributes !== undefined &&
    (typeof m.contributes !== "object" || m.contributes === null || Array.isArray(m.contributes))
  ) {
    throw new Error(`Manifest: "contributes" must be an object (driver "${m.id}")`);
  }
  if (m.entry !== undefined && typeof m.entry !== "string") {
    throw new Error(`Manifest: "entry" must be a string (driver "${m.id}")`);
  }

  return {
    id: m.id,
    name: m.name,
    ...(m.icon !== undefined && { icon: m.icon as string }),
    ...(m.hasWorkspace !== undefined && { hasWorkspace: m.hasWorkspace as boolean }),
    ...(m.source !== undefined && { source: m.source as string }),
    ...(m.description !== undefined && { description: m.description as string }),
    ...(m.tags !== undefined && { tags: m.tags as string[] }),
    ...(m.kind !== undefined && { kind: m.kind as string }),
    version: m.version,
    ...(m.minKernelVersion !== undefined && { minKernelVersion: m.minKernelVersion as string }),
    ...(m.dependencies !== undefined && { dependencies: m.dependencies as string[] }),
    ...(m.settingsSchema !== undefined && { settingsSchema: m.settingsSchema as Record<string, unknown> }),
    ...(m.reloadable !== undefined && { reloadable: m.reloadable as boolean }),
    ...(m.contributes !== undefined && { contributes: m.contributes as Record<string, unknown> }),
    ...(m.entry !== undefined && { entry: m.entry as string }),
  };
}
