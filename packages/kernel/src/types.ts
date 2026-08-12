/**
 * 内核公共类型（领域无关）。
 * 这里没有 Tool / Stage / Conversation 等任何领域概念——它们由插件在各自的领域里定义。
 */

/** 插件 manifest —— 插件在清单里声明自己的元信息与静态贡献。 */
export interface PluginManifest {
  /** 全局唯一插件 id，如 "minex.demo" */
  id: string;
  name: string;
  version: string;
  /** 要求内核版本 >= 此值，过低则拒绝激活 */
  minKernelVersion?: string;
  /** 依赖的其他插件 id（激活顺序保证，阶段 2 细化） */
  dependencies?: string[];
  /** 插件的设置 schema（JSON Schema）。UI 据此渲染表单，存储据此校验 */
  settingsSchema?: Record<string, unknown>;
  /** 是否允许热重载（停用→激活）。默认 true */
  reloadable?: boolean;
  /** 静态贡献声明（阶段 2 细化）。激活前即可用 */
  contributes?: Record<string, unknown>;
}

/** 插件生命周期状态 */
export type PluginState = "discovered" | "loaded" | "activated" | "deactivated";

/** 插件激活时返回的清理函数（停用时调用） */
export type CleanupFn = () => void | Promise<void>;

/** 插件入口：manifest + activate。阶段 2 改为从文件加载。 */
export interface PluginModule {
  manifest: PluginManifest;
  activate: (ctx: PluginContext) => CleanupFn | void | Promise<CleanupFn | void>;
}

/** 能力注册表里的一个贡献项 */
export interface Contribution<Id extends string = string, T = unknown> {
  type: string;
  id: Id;
  value: T;
  pluginId: string;
  priority: number;
}

/** 注册表查询过滤条件 */
export interface QueryFilter {
  /** 只返回指定插件贡献的项 */
  plugin?: string;
}

/** 日志器（插件视角） */
export interface Logger {
  info(msg: string, ...args: unknown[]): void;
  warn(msg: string, ...args: unknown[]): void;
  error(msg: string, ...args: unknown[]): void;
}

/** 事件处理函数 */
export type EventHandler = (payload: unknown, topic: string) => void;

/**
 * PluginContext —— 内核暴露给单个插件实例的「接口把手」。
 *
 * 插件不 import 内核；它只收到这一个对象，对内核的全部操作都从它进去。
 * - 受限视图：只能操作跟自己有关的部分（自己的存储、盖上自己 id 的注册）
 * - 依赖注入：内核把接口「递」给插件，插件不需要主动找内核
 * - 按实例隔离：同一份插件代码可收到不同 ctx（未来多 agent 各一个）
 */
export interface PluginContext {
  readonly manifest: PluginManifest;
  /** 注册一个能力（自动盖上本插件 id；priority 高者胜） */
  register<T = unknown>(type: string, id: string, value: T, opts?: { priority?: number }): void;
  /** 注销一个能力 */
  unregister(type: string, id: string): void;
  /** 查询某类型的所有能力值（默认全部，可按插件过滤） */
  query<T = unknown>(type: string, filter?: QueryFilter): T[];
  /** 精确取一个能力值 */
  get<T = unknown>(type: string, id: string): T | undefined;
  /** 订阅事件，返回取消订阅函数 */
  on(topic: string, handler: EventHandler): () => void;
  /** 发出事件 */
  emit(topic: string, payload?: unknown): void;
  /** 只读自己的命名空间存储 */
  storage: KVNamespace;
  log: Logger;
}

/** 命名空间存储 */
export interface KVNamespace {
  get<T = unknown>(key: string): T | undefined;
  set<T = unknown>(key: string, value: T): void;
  delete(key: string): void;
  list(): string[];
}

/** 存储提供者：按名字开命名空间（实现可替换：内存 / JSON 文件 / 数据库） */
export interface StorageProvider {
  namespace(name: string): KVNamespace;
}
