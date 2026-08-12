/**
 * @minex/kernel — Minex 内核
 *
 * 领域无关的插件宿主，只提供四个原语（阶段 1 逐一实现）：
 *   - 插件生命周期（lifecycle）
 *   - 能力注册表（registry）
 *   - 事件总线（events）
 *   - 存储抽象（storage）
 *
 * 本文件为阶段 0 骨架。各原语在阶段 1 落地。
 */

/** 内核版本。插件在 manifest 中用 minKernelVersion 与之比较。 */
export const MINEX_KERNEL_VERSION = "0.1.0";

/** 插件 manifest 的骨架（阶段 2 补全：dependencies/settingsSchema/contributes/reloadable 等）。 */
export interface PluginManifest {
  id: string;
  name: string;
  version: string;
}
