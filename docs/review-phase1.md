# Minex 阶段 1 代码检阅简报

> 给检阅 agent 的上下文简报。目标：让审阅者不读项目历史也能理解设计意图，快速定位重点，并区分「设计决策」与「真实缺陷」。

## 一、项目目标

**Minex** 是一个**领域无关的插件宿主内核（微内核架构）**。内核只提供插件生命周期、能力注册表、事件总线、存储四个原语，**不绑定任何领域**（agent、对话、知识库都是第二步的插件）。

三个核心设计约束：
1. **内核只留机制，内容归插件、表现归 UI**——内核不认识 Tool/Stage/Conversation 等任何领域概念。
2. **插件不 import 内核**——插件只收到 `PluginContext`（受限视图），对内核的操作全部从它进去。
3. **两套视图**——插件拿 `PluginContext`（受限、盖章、只给 value），宿主（UI/CLI）拿 `kernel` 对象（全量、带元数据）。

## 二、当前阶段（阶段 1：内核核心）

已完成 @minex/kernel 四个原语 + PluginContext + 测试（19 用例全绿，`npm test` 验证）。tag `v0.1.0`。

**目录**：`packages/kernel/src/` 共 9 个文件：
- `constants.ts` — 内核版本号
- `types.ts` — 公共类型（PluginManifest / PluginContext / Contribution / KVNamespace / StorageProvider）
- `version.ts` — 版本比较工具
- `registry.ts` — 能力注册表（核心原语）
- `events.ts` — 事件总线
- `storage.ts` — 命名空间存储（内存 + JSON 文件两种实现）
- `lifecycle.ts` — 插件状态机
- `kernel.ts` — 组装四原语，暴露两套视图
- `index.ts` — 公开 API 入口

**测试**：`packages/kernel/test/`（registry/events/storage/lifecycle 四个测试文件）。

## 三、检阅范围

**在范围内**：
- `packages/kernel/src/*.ts` 全部源码
- `packages/kernel/test/*.ts` 测试（重点看覆盖缺口）
- 检阅维度：逻辑错误、类型安全、资源管理（泄漏/清理/异步）、边界条件、并发

**不在范围内（明确排除，勿审）**：
- 安全模型/沙箱/插件隔离——v1 是**全信任同进程**，这是设计决策不是缺陷
- UI 层、CLI 层、demo 插件——阶段 3/4/2 才做
- 领域概念（agent/对话/知识库）——Project 2

## 四、重点检阅对象（按优先级）

### P0 —— 生命周期正确性
- `lifecycle.ts`：
  - 依赖递归激活的**环检测**（`activating` 集合）是否可靠
  - 激活/停用是否**对称**（activate 里创建的状态，deactivate 是否全部回收）
  - `deactivate` 的幂等性、`register` 后未激活就 `unregister` 的边界
  - 异步激活（`activate` 返回 Promise）异常时 `activating` 是否会被 `finally` 正确释放
- `kernel.ts` 的 `destroy()`：是否遍历所有激活插件并停用；中途失败会怎样

### P0 —— 注册表语义
- `registry.ts`：
  - priority 覆盖逻辑：低优先级注册被拒绝（`if (existing && priority < existing.priority) return`）——检查边界：同优先级、priority 为负数、NaN
  - `unregisterByPlugin`：先收集变更再统一发事件，是否有遗漏或重复通知
  - `query` 返回的排序副本：是否误改内部结构

### P1 —— 资源与清理
- 停用插件后，其注册的贡献、订阅的事件、存储是否全部回收（有无泄漏路径）
- `storage.ts` JSON 文件实现的**非原子写**、无锁问题——评估单进程场景下的真实风险

### P1 —— 边界与类型
- `version.ts` `compareVersions` 对非数字段的处理（`parseInt("abc")` → NaN）
- `types.ts` / 各文件里 `as unknown as` 强转的位置——是否所有强转都有据可依
- 空命名空间、空 type、重复注册、未知插件 id 的异常路径

## 五、已知的 v1 设计决策（勿误报为缺陷）

以下行为是**故意为之**，请在报告中标注「设计决策」而非「缺陷」：

1. `createContext.unregister` **无归属检查**——任何插件可注销别的插件注册的同 type+id 贡献（除非 priority 挡住）。v2 才加归属校验。
2. **同进程、无沙箱**——插件可读任意文件、require 任意包。子进程隔离接口是预留的，v1 不用。
3. `events.ts` 无 topic 白名单/鉴权——任意插件可订阅/发送任意主题。
4. 内核与存储：`storage.ts` 是内核**唯一的 Node 绑定点**（`node:fs`），其余文件纯 TS 领域无关——这是适配点设计，不是耦合失误。

## 六、已知风险点（请验证严重性并给出建议）

1. `storage.ts` `persist` 直接 `writeFileSync`——进程崩溃可能写坏 JSON；多进程并发会冲突。
2. `version.ts` 非数字段的 NaN 比较。
3. `registry.ts` 无 size 上限——恶意/失控插件可无限注册撑爆内存。
4. `lifecycle.ts`：插件 `activate` 抛异常后，状态停在哪个值？是否有状态不一致的路径。
5. `kernel.ts`：`destroy()` 中一个插件 deactivate 失败，后续插件是否被跳过。

## 七、如何验证

```bash
npm install        # 安装依赖
npm run typecheck  # 类型检查（应通过）
npm run build      # 构建内核
npm test           # 运行测试（应 19 个全绿）
```

## 八、输出要求

检阅报告请按严重性分级给出结论：
- **BLOCKER**（必须修）：逻辑错误 / 数据不一致 / 资源泄漏
- **MAJOR**（建议修）：边界未处理 / 健壮性风险
- **MINOR**（可留）：风格 / 可维护性
- **INFO**：观察
对每个「已知风险点」明确判定：属实 / 不成立 / 程度如何。**不要报「全信任模型」为安全漏洞**——那是 v1 设计决策。
