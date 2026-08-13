# 多工作视图隔离边界（设计文档）

> 背景：review-phase28 问题 2 ——「多工作视图」是布局层概念，但内核（events/storage/registry/生命周期）仍是单例，导致跨实例干扰。本设计明确「实例私有 vs 全局共享」边界与事件定向方案，**先设计后代码**。

## 一、目标与原则

- **内核保持单例**（驱动生命周期 / 主题 / 设置全局一致，同一软件后台唯一）。
- 多工作视图 = **同一内核上的多份视图状态**：文档/会话/打开文件/停靠位是实例私有，驱动启停/设置/会话库是全局。
- 不引入「内核实例化」（驱动按实例各加载一份的成本高、与全局目标冲突）。

## 二、实例私有 vs 全局共享清单

| 范畴 | 项 | 现状 | 动作 |
|---|---|---|---|
| **实例私有** | 活动驱动、面板停靠态（dockState）、浮窗位置、栏宽折叠、活动左面板 | 已隔离（InstanceState） | — |
| **实例私有**（待补） | 文档编辑缓冲（`doc`）、当前打开的 `.ses`、渲染选项 | 全局共享（`namespace("minex.markdown")`） | 按实例命名空间（key 前缀 `instance-<id>`） |
| **实例私有**（待补） | `filesystem:openFile` 目标 | 全局广播 → 所有实例 markdown 面板都响应 | 事件 payload 携带 `targetInstanceId`，消费方按 prop 过滤 |
| **全局共享** | 驱动生命周期（启停/依赖）、主题、驱动设置、会话库（session store / index） | 全局 | 保持 |

> 会话库全局共享的推论：多实例可打开**同一 `.ses`**。文件写入有并发竞态（v1 单用户可接受；后续可「最后写者胜」或实例私有副本）。

## 三、事件定向方案（广播 + 定向两级）

```
全局事件（minex:dataChanged / 驱动状态变化）→ 广播（所有实例响应）
实例事件（filesystem:openFile）→ payload { path, targetInstanceId? }
```

- 生产端（文件树点击 / 会话总览点击）在 emit 时带 `targetInstanceId`（总览/文件树属于某实例 → 该实例 id）。
- 消费端（markdown workspace）接收 prop `instanceId`，回调里 `if (targetInstanceId && targetInstanceId !== instanceId) return`。
- 不做「实例内独立 EventBus」（改动大、维护双总线），用 payload 字段定向，**向后兼容**（无 targetInstanceId 时维持广播，兼容单实例）。

## 四、面板组件的实例上下文

- `WorkspaceInstance.renderPanel` 传 `instanceId` 给面板组件：`<Comp kernel={kernel} instanceId={instance.id} />`。
- 面板组件 props 扩展 `instanceId?: number`（可选，向后兼容——无实例概念的面板忽略）。
- markdown workspace 用 `instanceId` 做：doc 存储命名空间 + openFile 过滤。

## 五、重新加载的运行时占用检查

- `plan-apply` 现状只检测**静态依赖冲突**（manifest dependencies）。
- 需补：禁用 / 重新加载某驱动前，检查是否存在某实例 `dockState[id] === "main" && driverId === 目标驱动`（或该驱动能力正被消费），正在使用则**拒绝临时变更**（提示先停用相关工作区）。

## 六、实施分步（建议顺序，每步可独立验证）

1. **面板实例上下文**：`renderPanel` 传 `instanceId`；markdown workspace 接收并透传给事件过滤。
2. **openFile 定向**：`filesystem:openFile` payload 加 `targetInstanceId`；文件树 / 会话总览 emit 时携带；markdown 消费端按 prop 过滤。
3. **doc 实例化**：markdown workspace 存储 key 按 `instance-<id>` 前缀隔离（迁移旧 key 到默认实例）。
4. **reload 占用检查**：plan-apply 补运行时占用判断。
5. （可选）多实例持久化：InstanceState 存 localStorage（按实例 id）。

## 七、风险与约束

- **事件定向的边界**：若某事件天然应全局（如会话库变更），不带 targetInstanceId 维持广播。
- **doc 迁移**：现有单实例 `doc` 数据需映射到默认实例 key，避免丢失。
- 会话库全局共享下的多实例写同 `.ses`：记录为已知限制（v1 最后写者胜）。
