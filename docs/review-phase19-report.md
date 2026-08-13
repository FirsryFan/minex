# Minex 阶段 19 审查报告（驱动设置扩展点 + 删 demo + 驱动信息头部）

> 审查日期：2026-08-13　|　范围：appearance.driverSetting 扩展点、README 复用 markdown.render、删 demo、DriverHeader 抽取、markdown 设置页
> 对照：`docs/report-19.md`。类型错误经 tsc 实测；运行时崩溃路径按 JS 语义判定。

## 审查基线

- `npm test` ✅ **97/97** 全绿（14 文件）
- `npm run typecheck` ❌ **失败**（appearance-driver 3 个错误）
- `npm run build` ❌ 失败（appearance tsc 步骤失败）

**报告 19 声称「typecheck && build && test 三连全绿（验证 agent 执行）」与实际不符——typecheck 失败**。这是继 report-17 之后第二次「声称全绿、实际 typecheck 失败」：验证 agent 只跑 `npm test`（vitest 不 typecheck），没跑 typecheck/build。

---

## 一、BLOCKER（必须修）

### B1 — `DriverSettingsSection` 把 `query()` 返回的 `Contribution` 误当设置对象（漏 `.value`）
`packages/appearance-driver/src/settings-view.tsx:342-355`

```tsx
const settings = kernel.registry.query<DriverAppearanceSetting>("appearance.driverSetting");
...
{settings.map((ds) => (
  <div key={ds.driverId}>
    <div className="muted">{ds.title}</div>          // ← 应为 ds.value.title
    {ds.items.map((item) => (                          // ← 应为 ds.value.items
      <DriverSettingItem ... item={item} />
    ))}
  </div>
))}
```

**根因**：`CapabilityRegistry.query<T>()` 的签名是 `Contribution<string, T>[]`，**不是 `T[]`**。每个 `ds` 是 `{ type, id, value, driverId, priority, origin }`，设置数据在 `ds.value` 里。

**两类后果**：
1. **类型错误**（tsc 3 个错误：`TS2339 Property 'title'/'items' does not exist on Contribution`）——基线不绿；
2. **运行时崩溃**——`ds.items` 为 `undefined`，`ds.items.map(...)` 抛 TypeError → appearance 主题设置页的「驱动设置」区一旦渲染就崩。

**对照**：同文件 `AboutView`（`renderer.value.render`）和 `ThemeManager`（`c.value.mode`）都正确用了 `.value`，唯独 `DriverSettingsSection` 漏了。

**修复**：
```tsx
const settings = kernel.registry.query<DriverAppearanceSetting>("appearance.driverSetting").map((c) => c.value);
```
或 map 时解构 `const s = ds.value`。

---

## 二、上一轮（report-18）问题回归

| 上轮项 | 判定 |
|---|---|
| M1 persistThemes updater 内副作用 | ✅ 已修复（`themesRef` + 副作用移出 updater，`settings-view.tsx:33-44`） |
| M2 drivers:sync 漏 markdown | ✅ 已修复（脚本现为 `-w minex-appearance-driver -w minex-markdown-driver`） |
| m1 renderMarkdown 无测试 | ✅ 已修复（`markdown.test.ts` 4 用例） |

---

## 三、MINOR（可留）

- **m1** `DriverSettingItem` 的 `value` state 不随外部 storage 变化刷新（`useState` 只在挂载读 storage）。当前被「切换驱动详情 → 整棵 SettingsView 重挂载」掩盖，单窗口内外部改同一 key 的场景不存在；但同 key 双写（markdown 设置页 vs appearance 驱动设置区）的同步依赖重挂载，脆弱。
- **m2** 「驱动设置区」放在 `ThemeSettings`（每个主题选项卡内），但 codeFont 是 markdown 驱动的**全局**设置（与主题无关）——用户可能误以为它是「当前主题的代码字体」。语义混淆，非缺陷。
- **m3** `DriverSettingItem` 的 `color`/`select`/`string` 分支当前无驱动使用（markdown 只贡献 `font`），未测试路径。
- **m4** `applyCodeFont` 的引号拼接无去重（`--font-code: "${codeFont}"`），若 codeFont 已带引号会双引号。当前枚举值均无引号，不触发。
- **m5** appearance 对 markdown 是「增强型」硬依赖：AboutView 已有回退（无 renderer 纯文本），却声明 `dependencies: ["minex.markdown"]` 强制激活——markdown 激活失败会连带 appearance 激活失败。可接受，但依赖比实际需要更紧。

---

## 四、INFO（观察）

- **扩展点链路无环** ✓：DriverSettingItem 改 codeFont → 写 `minex.markdown` storage + emit `data:changed` → markdown `applyCodeFont` 重注册 theme + appearance `apply` 重注册 theme → ThemeManager 重注入。`apply`/`applyCodeFont` 均不 emit `data:changed`，无环。
- **依赖顺序正确** ✓：`drivers.ts` markdown 在前 appearance 在后；appearance `dependencies: ["minex.markdown"]`；CLI 宿主按目录名排序后 appearance 先 activate，但 lifecycle 依赖链保证 markdown 先激活——两种宿主都正确。
- **DriverHeader 抽取一致** ✓：settingsView 分支与默认分支都渲染 `<DriverHeader manifest={m} state={state} />`，字段统一（图标/名称/来源/状态/版本/简介）。
- **README 复用** ✓：appearance 的 `AboutView` 查 `markdown.render`，有则 HTML 渲染、无则纯文本回退；markdown 自己的设置页用 `renderMarkdown(readme)`（`useMemo` 缓存，仅算一次）。
- **删 demo 干净** ✓：`packages/demo-driver` 已删，根脚本/drivers.ts/sync 脚本均已清理，无残留引用。
- 顶栏选择器现在只列 markdown（唯一 `hasWorkspace: true`）✓。

---

## 五、报告 19 验收逐条判定

| 标准 | 判定 |
|---|---|
| 三连全绿 | ❌ **typecheck 失败**（B1） |
| 顶栏只列 markdown | ✅ |
| appearance 详情头部 + 介绍 README 渲染 | ✅（头部一致；AboutView 复用 render；但「驱动设置」区崩溃 B1） |
| 主题选项卡含驱动设置区、改字体生效 | ◐ **B1 崩溃**，字体链路本身无环正确 |
| markdown 详情头部 + 介绍/设置 | ✅ |

---

## 六、测试缺口

- `DriverSettingsSection` 无测试（B1 漏检；`registry.query` 返回 `Contribution[]` 的误用只需一个渲染测试即可抓出）。
- `DriverSettingItem` 无测试（stale value、各 type 分支、双写同步均未覆盖）。
- appearance 依赖 markdown 的激活顺序无集成测试。

---

## 七、结论与修复优先级

本轮设计（驱动设置扩展点）方向正确，链路无环、依赖顺序正确、DriverHeader 一致、demo 删除干净、上轮 M1/M2/m1 全部修复。**唯一 BLOCKER 是一个典型的「宿主视图 API 误用」**：

1. **B1**（BLOCKER）`DriverSettingsSection` 补 `.value`（`query(...).map(c => c.value)`，1 行）——恢复 typecheck + 消除运行时崩溃。

**流程问题（第二次出现）**：验证 agent 连续两轮只跑 `npm test` 不跑 typecheck，导致「声称三连全绿」与事实不符。B1 是 `registry.query` 返回 `Contribution` 而非 `T` 的语义误用——这类错误恰恰只有 typecheck 能抓住（vitest 不测类型）。**强烈建议把 `npm run typecheck` 设为提交前置硬门槛**，且为 `DriverSettingsSection` 补一个渲染测试。

**给学员的提示**：`kernel.registry.query<T>()` 返回 `Contribution<string, T>[]`（带 type/id/value/pluginId/priority/origin 的包装），取数据要 `.map(c => c.value)` 或 `.value`；`get<T>()` 同理返回 `Contribution | undefined`。这是内核「宿主视图」与「受限视图」（`ctx.query<T>()` 返回 `T[]`）的关键差异——扩展点消费方（宿主侧）容易漏。
