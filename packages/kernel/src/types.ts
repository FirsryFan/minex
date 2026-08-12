/**
 * 内核公共类型（领域无关）。
 * 这里没有 Tool / Stage / Conversation 等任何领域概念——它们由驱动在各自的领域里定义。
 */

/** 驱动 manifest —— 驱动在清单里声明自己的元信息与静态贡献。 */
export interface DriverManifest {
  /** 全局唯一驱动 id，如 "minex.demo" */
  id: string;
  name: string;
  /** 驱动图标（v1 为 emoji 字符串，后续可扩展为图片/CSS 类） */
  icon?: string;
  /** 是否有主界面（工作区）。无主界面的驱动（如外观/纯设置）不出现在顶栏驱动选择器 */
  hasWorkspace?: boolean;
  /** 来源（如 "本地" / 作者 / 仓库） */
  source?: string;
  /** 简介 */
  description?: string;
  version: string;
  /** 要求内核版本 >= 此值，过低则拒绝激活 */
  minKernelVersion?: string;
  /** 依赖的其他驱动 id（激活顺序保证，阶段 2 细化） */
  dependencies?: string[];
  /** 驱动的设置 schema（JSON Schema）。UI 据此渲染表单，存储据此校验 */
  settingsSchema?: Record<string, unknown>;
  /** 是否允许热重载（停用→激活）。默认 true */
  reloadable?: boolean;
  /** 静态贡献声明（manifest 声明的）。激活前即可用 */
  contributes?: Record<string, unknown>;
  /** 驱动入口文件（相对驱动目录）。loader 动态 import 它取 activate */
  entry?: string;
}

/** 驱动生命周期状态 */
export type DriverState = "discovered" | "loaded" | "activated" | "deactivated" | "failed";

/** 驱动激活时返回的清理函数（停用时调用） */
export type CleanupFn = () => void | Promise<void>;

/** 驱动入口：manifest + activate。阶段 2 改为从文件加载。 */
export interface DriverModule {
  manifest: DriverManifest;
  activate: (ctx: DriverContext) => CleanupFn | void | Promise<CleanupFn | void>;
}

/** 贡献的来源：manifest 静态声明（存活到驱动被卸载）或 activate 运行时注册（随停用清除） */
export type ContributionOrigin = "static" | "runtime";

/** 能力注册表里的一个贡献项 */
export interface Contribution<Id extends string = string, T = unknown> {
  type: string;
  id: Id;
  value: T;
  driverId: string;
  priority: number;
  /** 静态贡献随驱动注册存活（reload/停用不清除）；运行时贡献随停用/失败清除 */
  origin: ContributionOrigin;
}

/** 注册表查询过滤条件 */
export interface QueryFilter {
  /** 只返回指定驱动贡献的项 */
  driver?: string;
}

/** 日志器（驱动视角） */
export interface Logger {
  info(msg: string, ...args: unknown[]): void;
  warn(msg: string, ...args: unknown[]): void;
  error(msg: string, ...args: unknown[]): void;
}

/** 事件处理函数 */
export type EventHandler = (payload: unknown, topic: string) => void;

/**
 * DriverContext —— 内核暴露给单个驱动实例的「接口把手」。
 *
 * 驱动不 import 内核；它只收到这一个对象，对内核的全部操作都从它进去。
 * - 受限视图：只能操作跟自己有关的部分（自己的存储、盖上自己 id 的注册）
 * - 依赖注入：内核把接口「递」给驱动，驱动不需要主动找内核
 * - 按实例隔离：同一份驱动代码可收到不同 ctx（未来多 agent 各一个）
 */
export interface DriverContext {
  readonly manifest: DriverManifest;
  /** 注册一个能力（自动盖上本驱动 id）。冲突语义：priority 高者胜；同优先级先到者胜；同驱动重注册 = 更新 */
  register<T = unknown>(type: string, id: string, value: T, opts?: { priority?: number }): void;
  /** 注销一个能力 */
  unregister(type: string, id: string): void;
  /** 查询某类型的所有能力值（默认全部，可按驱动过滤） */
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
