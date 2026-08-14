import type { DriverManifest, DriverModule } from "@minex/kernel";
// Vite 直接加载驱动源码 + manifest + 图标资产（驱动内图片文件经 Vite 解析为 URL）
import appearanceManifestRaw from "../../appearance-driver/manifest.json";
import appearanceModuleRaw from "../../appearance-driver/src/index.js";
import appearanceIconUrl from "../../appearance-driver/assets/icon.svg";
import filesystemManifestRaw from "../../filesystem-driver/manifest.json";
import filesystemModuleRaw from "../../filesystem-driver/src/index.js";
import filesystemIconUrl from "../../filesystem-driver/assets/icon.svg";
import markdownManifestRaw from "../../markdown-driver/manifest.json";
import markdownModuleRaw from "../../markdown-driver/src/index.js";
import markdownIconUrl from "../../markdown-driver/assets/icon.svg";
import sessionManifestRaw from "../../session-driver/manifest.json";
import sessionModuleRaw from "../../session-driver/src/index.js";
import llmManifestRaw from "../../llm-driver/manifest.json";
import llmModuleRaw from "../../llm-driver/src/index.js";
import agentManifestRaw from "../../agent-driver/manifest.json";
import agentModuleRaw from "../../agent-driver/src/index.js";

const appearanceModule = appearanceModuleRaw as unknown as { activate: DriverModule["activate"] };
const appearanceManifest = appearanceManifestRaw as unknown as DriverManifest;
const filesystemModule = filesystemModuleRaw as unknown as { activate: DriverModule["activate"] };
const filesystemManifest = filesystemManifestRaw as unknown as DriverManifest;
const markdownModule = markdownModuleRaw as unknown as { activate: DriverModule["activate"] };
const markdownManifest = markdownManifestRaw as unknown as DriverManifest;
const sessionModule = sessionModuleRaw as unknown as { activate: DriverModule["activate"] };
const sessionManifest = sessionManifestRaw as unknown as DriverManifest;
const llmModule = llmModuleRaw as unknown as { activate: DriverModule["activate"] };
const llmManifest = llmManifestRaw as unknown as DriverManifest;
const agentModule = agentModuleRaw as unknown as { activate: DriverModule["activate"] };
const agentManifest = agentManifestRaw as unknown as DriverManifest;

/**
 * v1：显式驱动清单（浏览器无法读文件系统，驱动经 Vite 打包加载）。
 * manifest.icon 在文件加载场景是相对路径；此处用 Vite 解析的资产 URL 覆盖，供 <img> 渲染。
 * 顺序：基础驱动在前（filesystem 最先；markdown 先于 appearance）；llm 先于 agent（agent 依赖 llm）。
 * llm/agent 无图标资产（assets 目录不存在），不覆盖 icon——DriverIcon 有兜底（session 同先例）。
 */
export const DRIVERS: DriverModule[] = [
  { manifest: { ...filesystemManifest, icon: filesystemIconUrl }, activate: filesystemModule.activate },
  { manifest: { ...sessionManifest }, activate: sessionModule.activate },
  { manifest: { ...markdownManifest, icon: markdownIconUrl }, activate: markdownModule.activate },
  { manifest: { ...appearanceManifest, icon: appearanceIconUrl }, activate: appearanceModule.activate },
  { manifest: { ...llmManifest }, activate: llmModule.activate },
  { manifest: { ...agentManifest }, activate: agentModule.activate },
];
