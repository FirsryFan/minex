import type { DriverManifest, DriverModule } from "@minex/kernel";
// Vite 直接加载驱动源码 + manifest + 图标资产（驱动内图片文件经 Vite 解析为 URL）
import appearanceManifestRaw from "../../appearance-driver/manifest.json";
import appearanceModuleRaw from "../../appearance-driver/src/index.js";
import appearanceIconUrl from "../../appearance-driver/assets/icon.svg";
import demoManifestRaw from "../../demo-driver/manifest.json";
import demoModuleRaw from "../../demo-driver/src/index.js";
import demoIconUrl from "../../demo-driver/assets/icon.svg";

const demoModule = demoModuleRaw as unknown as { activate: DriverModule["activate"] };
const demoManifest = demoManifestRaw as unknown as DriverManifest;
const appearanceModule = appearanceModuleRaw as unknown as { activate: DriverModule["activate"] };
const appearanceManifest = appearanceManifestRaw as unknown as DriverManifest;

/**
 * v1：显式驱动清单（浏览器无法读文件系统，驱动经 Vite 打包加载）。
 * manifest.icon 在文件加载场景是相对路径；此处用 Vite 解析的资产 URL 覆盖，供 <img> 渲染。
 */
export const DRIVERS: DriverModule[] = [
  { manifest: { ...demoManifest, icon: demoIconUrl }, activate: demoModule.activate },
  { manifest: { ...appearanceManifest, icon: appearanceIconUrl }, activate: appearanceModule.activate },
];
