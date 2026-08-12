# Minex 阶段报告 03（2026-08-12）

> 报告制度（固定四节）：① 上次审查修改结果 + 代码定位 + 额外发现 ② 本轮目标与预期功能 ③ 具体实现 ④ 审查标准。
> 上一轮审查：`docs/report-02.md`（简报）→ `docs/review-phase2-report.md`（报告）。

---

## 一、上次审查问题的修改结果（v0.2.1）

### BLOCKER

| # | 问题 | 修复方式 | 代码定位 | 验证 |
|---|---|---|---|---|
| L1 | loadFromDir 失败泄漏静态贡献 | 逐个 try/catch，catch 内 `unregisterByPlugin` 回滚 + 记 failed | `packages/kernel/src/loader.ts:41-67` | `test/loader.test.ts` "L1: entry without activate…" |
| L2 | 静态贡献 reload 后丢失 | `Contribution.origin: "static" \| "runtime"`；`onDeactivated` 只清 runtime（静态随注册存活） | `types.ts:40-49`、`kernel.ts:92-102` | `test/loader.test.ts` "L2: pure static contributions survive reload" |

### MAJOR

| # | 问题 | 修复方式 | 代码定位 |
|---|---|---|---|
| L3 | 深层依赖失败孤儿激活 | 激活 session（整棵激活树新激活集合）失败逆序全回滚 | `lifecycle.ts:57-76, 100-104` |
| L4 | loadFromDir 非幂等 | `isRegistered` 检查，已注册跳过后汇报 `alreadyRegistered` | `loader.ts:51-54`、`kernel.ts:107-111` |
| L5 | 全错中止 | 逐个容错，失败记 `failed: {id,error}[]`，其余继续 | `loader.ts:41-67` |

### MINOR（顺手修）

m1 同插件优先级降级放行（`registry.ts:52-63`）、m2 compareVersions 严格十进制（`version.ts`）、m3 loader 目录排序确定性（`loader.ts:33-39`）、m4 manifest id 收紧（`manifest.ts:7-10`）、m7 plugins:sync 前置构建（`package.json`）、m8 JSON 语法错误测试。

### 额外的发现（本轮 3 个）

1. **demo-plugin 依赖版本失配**：`@minex/kernel: ^0.1.1` 无法由已升到 0.2.1 的工作区满足 → `npm install` 404 去 registry 找。修复：升到 `^0.2.1`（`packages/demo-plugin/package.json`）。**教训：依赖工作区内部包必须同步版本。**
2. **CLI 测试预期错误**：`contributes` 静态贡献只在 `loadFromDir` 时自动注册，直接 `kernel.plugins.register` 不走该路径——测试先假设错了，修正为显式注册无 handler 命令。
3. **config set 同次激活不生效**：`main()` 先激活全部插件再 dispatch config，故 `config set` 当次运行 demo 看不到新值（下次激活才读到）。UX 缺陷，v1 接受。

---

## 二、本轮目标与预期功能（阶段 3，tag v0.3.0）

**目标**：CLI 宿主——无 UI 也能用内核，证明「内核与表现层无关」。

**预期功能**：
1. `minex run <commandId> [args...]`：查 command 贡献的 handler 并执行。
2. `minex config get/set`：读写插件命名空间存储（值支持 JSON）。
3. `minex plugins list / activate / deactivate / reload`：生命周期管理。
4. 启动即 `loadFromDir` + 激活全部插件；加载失败逐个汇报不中止。

---

## 三、具体实现内容

### 数据流

```
argv → main() → createKernel(storageDir=.minex-data)
   → loadFromDir(./plugins) → 激活全部
   → dispatch:
       run    → registry.get("command", id).value.handler(...)
       config → storage.namespace(pluginId).get/set(key, JSON.parse(value))
       plugins→ lifecycle.getState / activate / deactivate / reload
   → finally: kernel.destroy()
```

### 文件清单与联系

| 文件 | 职责 | 连接 |
|---|---|---|
| `packages/cli/package.json` | bin: `minex` → dist/cli.js | 依赖 @minex/kernel |
| `packages/cli/src/cli.ts` | bin 入口（shebang + main） | —— |
| `packages/cli/src/main.ts` | `main` 装配 + `runCommand/configCmd/pluginsCmd` 三个可测命令 | 调 kernel.plugins/registry/storage |
| `packages/cli/test/main.test.ts` | 6 用例（注入内存 kernel 测命令） | —— |
| 根 `package.json` | `cli` 脚本、build/typecheck 纳入 @minex/cli | —— |

### 关键设计决策

1. **命令 = 注册表贡献**：`run` 不硬编码命令，从 registry 查 `command` 类型——命令发现完全走插件贡献，宿主零领域知识。
2. **可测性**：三个命令函数接受 `kernel` 参数（依赖注入），测试用内存 kernel + console spy，不跑真实进程。
3. **config 值支持 JSON**：`JSON.parse` 成功即对象，失败保留字符串——设置存储是「任意 JSON 值」。

---

## 四、审查标准

### 必须通过

1. `npm run build` / `npm run typecheck` / `npm test` 全绿（**63 用例**，8 文件）。
2. 端到端：`npm run plugins:sync` 后 `minex run demo.sayHello Minex` → `Hello, Minex!`；`minex config set minex.demo config '{"greeting":"Hi"}'` 后下次激活 demo 读到新值。

### 重点审查

- **P0 `main.ts`**：启动激活全部插件的副作用（config 命令不需要激活却激活了）；`run` 对 handler 类型的假设（`(…args: string[]) => unknown`，与 demo 的 `(name?: string)` 兼容性）；`main` 的 `finally destroy` 在 dispatch 抛错时是否可靠。
- **P0 CLI 与内核边界**：CLI 是否遵守「宿主只读 registry/storage、不触碰内核内部」；有没有绕开 `PluginContext` 直接操作内核的地方。
- **P1 错误路径**：loadFromDir 失败汇报是否清晰；`run` 对 handler 抛错的捕获（当前未捕获，会冒泡到 main → 非零退出，是否符合预期）。
- **P1 config**：`JSON.parse` 的宽松性（`"null"`/`"123"` 会被解析为值而非字符串，是否符合预期）。

### 已知限制（勿误报为缺陷）

- config set 当次激活不生效（见额外发现 3，v1 接受）。
- CLI 无参数校验库（argv 手写解析），命令数少时足够。
- `.minex-data/` 是运行时数据目录（已 gitignore）。
