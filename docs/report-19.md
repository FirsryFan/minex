# Minex 阶段报告 19（2026-08-13）—— 第二批完成：驱动设置扩展点 + 删 demo + 驱动信息头部

> 报告制度（固定四节）。覆盖：appearance README 复用 markdown.render、删 demo 驱动、驱动设置扩展点、驱动信息头部、markdown README。

---

## 一、本轮内容与修改结果

| # | 内容 | 实现 | 定位 |
|---|---|---|---|
| 1 | appearance README 复用 markdown.render | `AboutView` 查 `markdown.render` 能力，有则渲染 HTML，无则回退纯文本；appearance manifest 加 `dependencies: ["minex.markdown"]` | `appearance-driver/src/settings-view.tsx` + `manifest.json` |
| 2 | 删 demo 驱动 | 移除 `packages/demo-driver`、drivers.ts 清理、根脚本清理（build/typecheck/drivers:sync） | `packages/demo-driver`（删）+ `drivers.ts` + `package.json` |
| 3 | 驱动信息头部 | `DriverDetail` 抽取 `DriverHeader`（图标 + 名称/来源/状态/版本/简介），settingsView 分支也显示 | `ui-shell/src/components/DriverDetail.tsx` |
| 4 | markdown 设置页加 README | `settings-view.tsx` 改为「介绍（README）/设置（代码块字体）」选项卡，`?raw` 导入 + `renderMarkdown` 渲染 | `markdown-driver/src/settings-view.tsx` + `vite-env.d.ts` |
| 5 | **驱动设置扩展点** | markdown 注册 `appearance.driverSetting`（代码块字体）；appearance 的 `ThemeSettings` 加「驱动设置」区（`DriverSettingsSection`）渲染贡献、读写对应驱动 storage | `markdown-driver/src/index.ts` + `appearance-driver/src/settings-view.tsx` |

---

## 二、扩展点机制（本轮核心设计）

**「驱动设置」扩展点**：其他驱动的外观设置统一交给 appearance 管理。

```
markdown 驱动 ──register("appearance.driverSetting", ...)──► registry
                                                               ▲
appearance ThemeSettings ──query("appearance.driverSetting")──┘ → 渲染「驱动设置」区
```

**契约**：
```ts
interface DriverAppearanceSetting {
  driverId: string;   // storage namespace（读写在对应驱动名下）
  title: string;      // 显示名
  items: { key, label, type: "font"|"color"|"select"|"string", enum?, default? }[];
}
```

- markdown 注册 `{ driverId: "minex.markdown", title: "Markdown 编辑器", items: [{ key: "codeFont", type: "font", enum: [...] }] }`。
- appearance 的 `DriverSettingsSection` 渲染所有贡献，每项读写 `storage.namespace(driverId).get/set(key)` + `emit("minex:dataChanged")`。
- 代码块字体既在 markdown 自己的设置页可改，也在 appearance 的「驱动设置」区可改——共享同一 storage key。

---

## 三、审查标准

### 必须通过

1. `npm run typecheck && npm run build && npm test` 三连全绿（验证 agent 执行）。
2. 顶栏选择器只列 markdown（demo 已删，appearance 无 workspace）。
3. 打开 appearance 详情 → 头部显示图标/名称/来源/状态/版本；介绍 tab 渲染 README（markdown 渲染，非纯文本）。
4. 双击主题 → 主题选项卡含「驱动设置」区（Markdown 编辑器 → 代码块字体），改字体即时生效。
5. 打开 markdown 详情 → 头部信息 + 介绍（README）/设置选项卡。

### 重点审查

- **P0 扩展点链路**：markdown 注册 `appearance.driverSetting` → appearance `query` 渲染 → 改字体写 `minex.markdown` storage → emit → markdown `applyCodeFont` 重注册 theme → `--font-code` 生效。
- **P0 依赖顺序**：DRIVERS 数组 markdown 在 appearance 前；appearance `dependencies` 声明；boot 激活顺序。
- **P1 DriverHeader 抽取**：两个分支（settingsView / 默认）的 header 一致性；`DriverManifest` 类型导入。
- **P1 markdown settings-view**：`?raw` 声明（vite-env.d.ts）；`renderMarkdown` 自渲染 README。
- **P1 驱动设置读写**：`DriverSettingItem` 的 useState 初始化读 storage；切换主题重挂载后值正确。

### 已知限制（勿误报）

- 「主题商店」仍是虚线占位。
- 「指定默认浅色/深色主题」未做选择 UI（固定 default-light/default-dark）。
- 文件读写（打开/保存 .md）留待 Electron。
- markdown 的 CODE_FONTS 在 index.ts 与 settings-view.tsx 各定义一份（重复但独立，可接受）。
