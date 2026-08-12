/**
 * @minex/kernel —— Minex 内核（领域无关的驱动宿主）
 *
 * 提供四个原语：
 *   - 驱动生命周期（lifecycle）
 *   - 能力注册表（registry）
 *   - 事件总线（events）
 *   - 存储抽象（storage）
 *
 * 用法：createKernel() → kernel.drivers.register({ manifest, activate }) → activate。
 */

export { MINEX_KERNEL_VERSION } from "./constants.js";

export type {
  CleanupFn,
  Contribution,
  EventHandler,
  KVNamespace,
  Logger,
  DriverContext,
  DriverManifest,
  DriverModule,
  DriverState,
  QueryFilter,
  StorageProvider,
} from "./types.js";

export { createEventBus, type EventBus } from "./events.js";
export { createLifecycle, type Lifecycle } from "./lifecycle.js";
export { loadDriversFromDir, registerStaticContributions, type LoadResult, type DriverLoaderHost } from "./loader.js";
export { parseManifest } from "./manifest.js";
export {
  createRegistry,
  type CapabilityRegistry,
  type RegistryChange,
} from "./registry.js";
export { createInMemoryStorage, createJsonFileStorage } from "./storage.js";
export { compareVersions } from "./version.js";
export { createKernel, type KernelOptions, type MinexKernel } from "./kernel.js";
