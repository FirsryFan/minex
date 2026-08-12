import type { DriverManifest, DriverModule } from "@minex/kernel";
// Vite 直接加载 TS 驱动源码 + manifest（dev 与 build 都经 Vite 模块图）
import demoManifestRaw from "../../demo-driver/manifest.json";
import demoModuleRaw from "../../demo-driver/src/index.js";

const demoModule = demoModuleRaw as unknown as { activate: DriverModule["activate"] };
const demoManifest = demoManifestRaw as unknown as DriverManifest;

/**
 * v1：显式驱动清单（浏览器无法读文件系统，驱动经 Vite 打包加载）。
 * 后续可换「驱动管理器」从远程/配置发现。
 */
export const DRIVERS: DriverModule[] = [{ manifest: demoManifest, activate: demoModule.activate }];
