import type { PluginManifest } from "./types.js";

/** 插件 id 允许的字符：字母数字 + 点号（反向域名风格）*/
const ID_RE = /^[A-Za-z0-9._-]+$/;

/** 解析并校验 manifest。非法输入抛带明确信息的错误（错误早暴露）。 */
export function parseManifest(raw: unknown): PluginManifest {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`Manifest: must be a JSON object`);
  }
  const m = raw as Record<string, unknown>;

  if (typeof m.id !== "string" || !ID_RE.test(m.id)) {
    throw new Error(`Manifest: "id" must be a non-empty string matching ${ID_RE} (got ${JSON.stringify(m.id)})`);
  }
  if (typeof m.name !== "string" || !m.name) {
    throw new Error(`Manifest: "name" must be a non-empty string (plugin "${m.id ?? "?"}")`);
  }
  if (typeof m.version !== "string" || !m.version) {
    throw new Error(`Manifest: "version" must be a non-empty string (plugin "${m.id ?? "?"}")`);
  }
  if (m.minKernelVersion !== undefined && typeof m.minKernelVersion !== "string") {
    throw new Error(`Manifest: "minKernelVersion" must be a string (plugin "${m.id}")`);
  }
  if (
    m.dependencies !== undefined &&
    !(Array.isArray(m.dependencies) && m.dependencies.every((d) => typeof d === "string"))
  ) {
    throw new Error(`Manifest: "dependencies" must be an array of strings (plugin "${m.id}")`);
  }
  if (
    m.settingsSchema !== undefined &&
    (typeof m.settingsSchema !== "object" || m.settingsSchema === null || Array.isArray(m.settingsSchema))
  ) {
    throw new Error(`Manifest: "settingsSchema" must be an object (plugin "${m.id}")`);
  }
  if (m.reloadable !== undefined && typeof m.reloadable !== "boolean") {
    throw new Error(`Manifest: "reloadable" must be a boolean (plugin "${m.id}")`);
  }
  if (
    m.contributes !== undefined &&
    (typeof m.contributes !== "object" || m.contributes === null || Array.isArray(m.contributes))
  ) {
    throw new Error(`Manifest: "contributes" must be an object (plugin "${m.id}")`);
  }
  if (m.entry !== undefined && typeof m.entry !== "string") {
    throw new Error(`Manifest: "entry" must be a string (plugin "${m.id}")`);
  }

  return {
    id: m.id,
    name: m.name,
    version: m.version,
    ...(m.minKernelVersion !== undefined && { minKernelVersion: m.minKernelVersion as string }),
    ...(m.dependencies !== undefined && { dependencies: m.dependencies as string[] }),
    ...(m.settingsSchema !== undefined && { settingsSchema: m.settingsSchema as Record<string, unknown> }),
    ...(m.reloadable !== undefined && { reloadable: m.reloadable as boolean }),
    ...(m.contributes !== undefined && { contributes: m.contributes as Record<string, unknown> }),
    ...(m.entry !== undefined && { entry: m.entry as string }),
  };
}
