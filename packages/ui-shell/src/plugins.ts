import type { PluginManifest, PluginModule } from "@minex/kernel";
// Vite 直接加载 TS 插件源码 + manifest（dev 与 build 都经 Vite 模块图）
import demoManifestRaw from "../../demo-plugin/manifest.json";
import demoModuleRaw from "../../demo-plugin/src/index.js";

const demoModule = demoModuleRaw as unknown as { activate: PluginModule["activate"] };
const demoManifest = demoManifestRaw as unknown as PluginManifest;

/**
 * v1：显式插件清单（浏览器无法读文件系统，插件经 Vite 打包加载）。
 * 后续可换「插件管理器」从远程/配置发现。
 */
export const PLUGINS: PluginModule[] = [{ manifest: demoManifest, activate: demoModule.activate }];
