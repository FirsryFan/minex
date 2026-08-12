# Minex 阶段报告 02（2026-08-12）

> 报告制度（每轮固定四节）：① 上次审查的修改结果 + 代码定位 + 额外发现 ② 本轮目标与预期功能 ③ 具体实现 ④ 审查标准。
> 上一轮审查：`docs/review-phase1.md`（简报）→ `docs/review-phase1-report.md`（报告）。

---

## 一、上次审查问题的修改结果（v0.1.1）

### BLOCKER

| # | 问题 | 修复方式 | 代码定位 | 验证 |
|---|---|---|---|---|
| B1 | 激活失败副作用残留 | 失败回滚：dispose 先存后跑、依赖逆序停用、onDeactivated 清贡献、`failed` 态可重试 | `packages/kernel/src/lifecycle.ts:76-104` | `test/lifecycle.test.ts` "activate failure rolls back…" |
| B2 | 同优先级「后注册覆盖」，违背契约 | 改为先到者胜；同插件重注册 = 更新 | `packages/kernel/src/registry.ts:54-66` | `test/registry.test.ts` "same priority + different plugin" |

### MAJOR

| # | 问题 | 修复方式 | 代码定位 |
|---|---|---|---|
| M1 | destroy 一个失败跳过后续 | 逐插件 try/catch 继续 | `packages/kernel/src/kernel.ts:130-140` |
| M2 | reloadable 死代码 | 实现 `reload`；`reloadable:false` 拒绝 | `packages/kernel/src/lifecycle.ts:123-132` |
| M3 | compareVersions NaN 静默判等 | 非数字段改字符串比较 | `packages/kernel/src/version.ts:1-20` |
| M4 | JSON 存储非原子写 | 写 tmp + renameSync 原子替换 | `packages/kernel/src/storage.ts:63-72` |
| M5 | 依赖失败部分激活 | 逆序停用本次新激活的依赖 | `packages/kernel/src/lifecycle.ts:76-80` |
| M6 | 并发 activate 误报环 | in-flight Promise 去重 + 调用链环检测分离 | `packages/kernel/src/lifecycle.ts:108-123` |

### MINOR（本轮顺手修的）

m2 NaN/Infinity priority 归 0（`registry.ts:57`）、m3 非法 namespace 拒绝而非替换（`storage.ts:38-41`）、m5 handler 抛错不阻断分发（`events.ts:14-22`、`registry.ts:70-77`）、m7 unregister 激活中保护（`lifecycle.ts:147-149`）、m8 非序列化值清晰报错（`storage.ts:60-62`）。

### 额外的发现（测试抓出 2 个真 bug，检阅未覆盖）

1. **订阅泄漏**：`r.dispose` 原在 activate **成功后才赋值**，失败时 catch 拿不到引用 → 订阅永远不回收。修复：赋值提前到 `activate()` 调用之前（`lifecycle.ts:85-87`）。由新测试「activate failure rolls back contributions + subscriptions」抓出。
2. **校验被吞**：namespace 校验写在 `fileOf()`，被 `load()` 的 try/catch 当「文件缺失」吞掉 → `namespace("a/b")` 不抛错。修复：校验移到 `namespace()` 入口（`storage.ts:44-46`）。由新测试「rejects invalid namespace name」抓出。

**教训**：失败路径必须显式测试——本轮的 B1/M1/M5/M6 全部靠补失败路径用例才暴露/确认。

---

## 二、本轮目标与预期功能（阶段 2，tag v0.2.0）

**目标**：从「内存模块注册」升级到「目录文件加载」——内核真正能发现、校验、加载磁盘上的插件。

**预期功能**：
1. `parseManifest`：manifest 解析 + 严格校验（必填 id/name/version、id 格式、可选字段类型）。
2. `loadPluginsFromDir`：扫描目录，跳过非插件目录；静态贡献（manifest.contributes）自动注册（激活前可见）；entry 动态 import 取 `activate`；加载 = 注册不激活。
3. `kernel.plugins.loadFromDir`：宿主入口。
4. `packages/demo-plugin`：三通道验证（UI 贡献 / 命令 / 工具）+ 设置读取。
5. reload（接续 M2）。

---

## 三、具体实现内容

### 数据流框架

```
plugins/<id>/manifest.json + index.js（.mjs）
  → loadPluginsFromDir (packages/kernel/src/loader.ts)
      ├─ parseManifest 校验 (manifest.ts)
      ├─ registerStaticContributions → registry（激活前可见，value=完整描述符）
      └─ import(file://...entry) → { activate } → kernel.plugins.register
  → 调用方显式 kernel.plugins.activate(id)
  → activate(ctx) 里同 id 重注册 = 更新（补 handler，声明式→命令式）
```

### 文件清单与联系

| 文件 | 职责 | 连接 |
|---|---|---|
| `packages/kernel/src/manifest.ts` | manifest 解析 + 校验（新） | 被 loader 调用 |
| `packages/kernel/src/loader.ts` | 目录加载 + 静态贡献注册（新） | 调 manifest；经 `PluginLoaderHost` 接口回 kernel |
| `packages/kernel/src/types.ts` | 补 `entry?: string` 到 PluginManifest | 全局类型 |
| `packages/kernel/src/kernel.ts` | 新增 `plugins.loadFromDir` | 暴露 loader 给宿主 |
| `packages/kernel/src/index.ts` | 导出 manifest/loader | 公共 API |
| `packages/demo-plugin/{package.json,manifest.json,src/index.ts,tsconfig.json}` | 三通道 demo（新） | 依赖 @minex/kernel 类型 |
| `scripts/sync-plugins.mjs` | 同步 demo → `plugins/minex.demo/`（新） | 构建后生成运行时插件目录 |
| `packages/kernel/test/manifest.test.ts` | 校验 6 用例（新） | —— |
| `packages/kernel/test/loader.test.ts` | 加载 5 用例（新，临时目录 fixture） | —— |

### 关键设计决策

1. **声明式 + 命令式混合**：manifest.contributes 静态注册（UI 激活前可见）→ activate 里同 id 重注册升级为带 handler（依赖 registry「同插件重注册 = 更新」语义，B2 修复的副产品）。
2. **避免循环依赖**：loader 只依赖最小宿主接口 `PluginLoaderHost`（register + registerStatic），不 import kernel。
3. **Windows 动态 import**：entry 用 `pathToFileURL` 转 file:// URL（绝对路径 import 在 Windows 必须 URL）。
4. **plugins/ 是运行时产物**：gitignore；从 packages/demo-plugin 同步生成，`scripts/sync-plugins.mjs` 写入 `{type:"module"}` 消除 ESM 警告。

---

## 四、审查标准

### 必须通过

1. `npm run build` / `npm run typecheck` / `npm test` 全绿（**48 用例**）。
2. 冒烟测试（仓库根目录）：`npm run plugins:sync` 后，`loadFromDir('./plugins') → activate('minex.demo')` → command/tool/ui 三通道可调用。

### 重点审查

- **P0 `loader.ts`**：
  - 重复 `loadFromDir` 同一目录 → 会不会重复注册（duplicate registration 会抛错，属预期还是缺陷？）
  - entry 路径解析正确性（相对/绝对、Windows）
  - **import 缓存**：reload 复用同一 activate，不重新 import 代码——已知限制还是需要 cache-busting？
- **P0 `manifest.ts`**：校验是否覆盖全部必填与类型错误；id 格式正则过严/过松？
- **P1 中途失败语义**：`loadFromDir` 扫描到第 N 个插件失败（manifest 非法/entry 无 activate）→ 前 N-1 个已注册的**不回滚**，直接抛错中止。是否应改为「逐个容错，失败跳过并汇报」？请给出建议。
- **P1 `demo-plugin`**：command handler 的 shape（`{id,label,handler}`）是否值得进内核类型定义，还是留给领域？

### 已知限制（勿误报为缺陷）

- reload 是**软重载**：复用同一 activate 函数，不重新 import（代码级热更新 = v2）。
- loadFromDir 中途失败不回滚（见 P1 待决策）。
- 静态贡献只注册描述符，真正的可调用 handler 必须由 activate 补。
