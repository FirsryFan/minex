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
}

export interface LoadResult {
  manifests: PluginManifest[];
  /** 被跳过的目录（无 manifest.json） */
  skipped: string[];
}

/**
 * 从目录加载插件。布局：dir/<pluginId>/manifest.json + entry 文件。
 * - 静态贡献（manifest.contributes）自动注册，激活前可见；
 * - entry 文件 default 导出 `{ activate }` 或命名导出 `activate`；
 * - 加载 = 发现 + 注册（register），不激活（activate 由调用方显式触发）。
 */
export async function loadPluginsFromDir(dir: string, host: PluginLoaderHost): Promise<LoadResult> {
  const manifests: PluginManifest[] = [];
  const skipped: string[] = [];
  if (!fs.existsSync(dir)) return { manifests, skipped };

  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!ent.isDirectory()) continue;
    const pluginDir = path.join(dir, ent.name);
    const manifestPath = path.join(pluginDir, "manifest.json");
    if (!fs.existsSync(manifestPath)) {
      skipped.push(ent.name);
      continue;
    }

    const manifest = parseManifest(JSON.parse(fs.readFileSync(manifestPath, "utf8")) as unknown);
    registerStaticContributions(host, manifest);

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
          `Manifest: entry of "${manifest.id}" (${manifest.entry}) must export an "activate" function (default export object or named export)`,
        );
      }
      activate = activateRaw as PluginModule["activate"];
    }

    host.register({ manifest, activate });
    manifests.push(manifest);
  }
  return { manifests, skipped };
}

/** manifest.contributes → 注册表静态贡献（value = 完整描述符，UI 激活前即可读） */
function registerStaticContributions(host: PluginLoaderHost, manifest: PluginManifest): void {
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
