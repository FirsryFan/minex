/**
 * @minex/kernel —— Minex 内核（领域无关的插件宿主）
 *
 * 提供四个原语：
 *   - 插件生命周期（lifecycle）
 *   - 能力注册表（registry）
 *   - 事件总线（events）
 *   - 存储抽象（storage）
 *
 * 用法：createKernel() → kernel.plugins.register({ manifest, activate }) → activate。
 */

export { MINEX_KERNEL_VERSION } from "./constants.js";

export type {
  CleanupFn,
  Contribution,
  EventHandler,
  KVNamespace,
  Logger,
  PluginContext,
  PluginManifest,
  PluginModule,
  PluginState,
  QueryFilter,
  StorageProvider,
} from "./types.js";

export { createEventBus, type EventBus } from "./events.js";
export { createLifecycle, type Lifecycle } from "./lifecycle.js";
export { loadPluginsFromDir, type LoadResult, type PluginLoaderHost } from "./loader.js";
export { parseManifest } from "./manifest.js";
export {
  createRegistry,
  type CapabilityRegistry,
  type RegistryChange,
} from "./registry.js";
export { createInMemoryStorage, createJsonFileStorage } from "./storage.js";
export { compareVersions } from "./version.js";
export { createKernel, type KernelOptions, type MinexKernel } from "./kernel.js";
