import * as fs from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { parseManifest } from "./manifest.js";
import type { PluginManifest, PluginModule } from "./types.js";

/** 内核暴露给 loader 的最小宿主接口（避免 loader ↔ kernel 循环依赖） */
export interface PluginLoaderHost {
  register(module: PluginModule): void;
  /** 注册静态贡献（manifest 声明的，激活前即可见） */
  registerStatic(type: string, id: string, value: unknown, pluginId: string): void;
  /** 回滚某插件的全部贡献（加载失败时清理已注册的静态贡献） */
  unregisterByPlugin(pluginId: string): void;
  /** 某插件是否已注册 */
  isRegistered(pluginId: string): boolean;
}

export interface LoadFailure {
  id: string;
  error: string;
}

export interface LoadResult {
  manifests: PluginManifest[];
  /** 被跳过的目录（无 manifest.json） */
  skipped: string[];
  /** 已注册而跳过的插件 id（目录重复加载） */
  alreadyRegistered: string[];
  /** 加载失败的插件（逐个容错，不影响其他插件） */
  failed: LoadFailure[];
}

/**
 * 从目录加载插件。布局：dir/<pluginId>/manifest.json + entry 文件。
 * 逐个容错：单个插件失败只回滚它自己的静态贡献并记入 failed，不中止其余。
 * 目录按名排序保证加载顺序确定（先到者胜语义不被 FS 枚举顺序影响）。
 */
export async function loadPluginsFromDir(dir: string, host: PluginLoaderHost): Promise<LoadResult> {
  const result: LoadResult = { manifests: [], skipped: [], alreadyRegistered: [], failed: [] };
  if (!fs.existsSync(dir)) return result;

  const names = fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort(); // m3：确定性顺序

  for (const name of names) {
    const pluginDir = path.join(dir, name);
    const manifestPath = path.join(pluginDir, "manifest.json");
    if (!fs.existsSync(manifestPath)) {
      result.skipped.push(name);
      continue;
    }

    let pluginId = name;
    try {
      const manifest = parseManifest(JSON.parse(fs.readFileSync(manifestPath, "utf8")) as unknown);
      pluginId = manifest.id;

      if (host.isRegistered(pluginId)) {
        result.alreadyRegistered.push(pluginId); // L4：已注册则跳过并汇报
        continue;
      }

      registerStaticContributions(host, manifest); // 先注册静态贡献（激活前可见）

      let activate: PluginModule["activate"] = () => {};
      if (manifest.entry) {
        const entryUrl = pathToFileURL(path.resolve(pluginDir, manifest.entry)).href;
        const mod = (await import(entryUrl)) as {
          default?: { activate?: unknown };
          activate?: unknown;
        };
        const activateRaw = mod.default?.activate ?? mod.activate;
        if (typeof activateRaw !== "function") {
          throw new Error(
            `Manifest: entry of "${manifest.id}" (${manifest.entry}) must export an "activate" function`,
          );
        }
        activate = activateRaw as PluginModule["activate"];
      }

      host.register({ manifest, activate });
      result.manifests.push(manifest);
    } catch (err) {
      // L1：失败回滚该插件已注册的静态贡献，记入 failed，继续下一个
      host.unregisterByPlugin(pluginId);
      result.failed.push({ id: pluginId, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return result;
}

/** manifest.contributes → 注册表静态贡献（value = 完整描述符，UI 激活前即可读）。浏览器宿主直接注册插件时复用。 */
export function registerStaticContributions(host: PluginLoaderHost, manifest: PluginManifest): void {
  const contributes = manifest.contributes;
  if (!contributes) return;
  for (const [type, items] of Object.entries(contributes)) {
    if (!Array.isArray(items)) continue;
    for (const item of items) {
      if (item && typeof item === "object" && typeof (item as { id?: unknown }).id === "string") {
        host.registerStatic(type, (item as { id: string }).id, item, manifest.id);
      }
    }
  }
}
