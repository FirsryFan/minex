# Minex 阶段报告 09（2026-08-12）—— 驱动详情页

> 报告制度（固定四节）。前置：`docs/report-08.md`（阶段 7 检阅修复 + 设计点落地）。

---

## 一、上次问题的处理结果

阶段 7 检阅（D1-D6）+ 学员三个设计点已在上轮处理并推送（`82d3e07`）：
- D1 设置页 toggle reload 容错、D2 localStorage key 编码、D4 undefined 删除、D5 损坏值容错、D6 删死代码。
- 图标 = 图片文件（`assets/icon.svg` + `DriverIcon` 组件 + Vite 资产合并）。
- 设计文档 `driver-architecture.md` 固化：⑧ 图标模型、⑨ 驱动交叉关系数据流、⑩ UI 组件驱动化。

---

## 二、本轮目标与预期功能（驱动详情页）

**目标**：补全驱动管理流程——列表「…」→ 驱动详情页（信息 + 选项卡 介绍/设置）。把通用设置表单在正确的驱动上下文里接回（上轮 D6 删除后，此处规范重建）。

**预期功能**：
1. 驱动管理表每行「…」→ 主体切到该驱动详情页；左上角返回按钮回列表。
2. 详情页顶部：驱动图标 + 名 + 版本 + 返回。
3. 选项卡（细线 + 选项卡）：**介绍**（id/版本/依赖/状态）与 **设置**（schema 表单）。
4. 设置表单：string/number/boolean，保存写 `storage.namespace(driverId).set("config")`，发 `minex:dataChanged`。

---

## 三、具体实现

### 文件清单与联系

| 文件 | 职责 |
|---|---|
| `packages/ui-shell/src/components/DriverDetail.tsx`（新） | 详情页：头部（返回+图标+名+版本）+ 选项卡 + 内容 |
| `packages/ui-shell/src/components/SettingsForm.tsx`（重加） | 通用 schema 表单（上轮删除后规范重建，U3 无裸断言） |
| `packages/ui-shell/src/components/SettingsPage.tsx` | `selectedDriverId` 状态；主体条件渲染详情；ManageView 加 `onOpenDetail`；「…」接上 |
| `packages/ui-shell/src/index.css` | `.detail-tabs` / `.detail-tab` 样式 |

### 数据流

```
驱动管理表 →「…」→ setSelectedDriverId(id)
  → SettingsPage 主体：selectedDriverId ? <DriverDetail driverId onBack> : ManageView
  → DriverDetail：介绍（kernel.drivers.list().find → manifest）/ 设置（SettingsForm schema）
  → SettingsForm：storage.namespace(driverId).get/set("config") + minex:dataChanged
```

### 关键设计

1. **设置表单在驱动上下文重建**：props 传 `kernel/driverId/schema`，不再全局查找「有 schema 的驱动」——U3 崩溃风险从根上消除。
2. **详情是设置页主体内的视图**（非独立路由）：`selectedDriverId` 状态，返回即清空——与设置页导航共存。
3. **设置 key 约定**：`config`（与 CLI/demo 一致）。

---

## 四、审查标准

### 必须通过

1. 构建/类型检查/测试全绿（验证 agent 执行；本轮无新增测试——设置页为纯 UI）。
2. 驱动管理 →「…」→ 详情页；返回回列表。
3. 详情页「介绍」显示 id/版本/依赖/状态；「设置」渲染 demo 的 `greeting` 表单，保存后 `.minex-data`/localStorage 的 config 更新。

### 重点审查

- **P0 SettingsForm**：schema 空值守卫；`driverId` 为不存在驱动的 namespace 访问（storage.namespace 允许任意合法名）；保存后事件触发。
- **P0 详情页导航**：`selectedDriverId` 清空逻辑；驱动被禁用/删除后详情页状态。
- **P1 选项卡**：切换状态；介绍 tab 的依赖显示（空数组不显示）。

### 已知限制（勿误报）

- 设置 tab 只支持 string/number/boolean 单层 schema；CSS 代码编辑（外观驱动用）留待外观驱动。
- 驱动详情「下载/总览」仍未实现（占位）。
