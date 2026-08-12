# Minex 项目工作流（Roadmap）

> 目标：先做出 Minex 通用插件外壳（Project 1），验收通过后做 agent 插件域（Project 2）。
> 原则：每个阶段 = 一个「看得见的效果」+ 一组组件 + 一个 git 检查点。
> 角色：学员 = 设计/审核；Designer = 实现。每阶段结束学员 review，通过才进下一阶段。

## 进度

- [x] 阶段 0 地基（2026-08-12，tag v0.0.1）
- [x] 阶段 1 内核核心（2026-08-12，tag v0.1.0）：registry/events/storage/lifecycle + PluginContext + 19 测试全绿
- [x] 阶段 1 检阅修复（2026-08-12，v0.1.1）：B1激活回滚/B2同优先级先到/M1 destroy容错/M2 reload实现/M3版本比较/M4原子写/M5依赖回滚/M6并发去重；37 测试全绿
- [x] 阶段 2 插件契约 + demo（2026-08-12，tag v0.2.0）：manifest 解析校验 + loadPluginsFromDir（静态贡献自动注册）+ reload + demo 插件三通道 + 48 测试全绿
- [x] 阶段 2 检阅修复（2026-08-12，v0.2.1）：L1 失败回滚静态贡献/L2 静态-运行时分离生命周期/L3 深层依赖回滚/L4 幂等/L5 逐个容错 + m1-m4/m7/m8；57 测试全绿
- [x] 阶段 3 CLI 宿主（2026-08-12，tag v0.3.0）：@minex/cli（run/config/plugins 三组命令）+ 63 测试全绿 + 端到端通
- [ ] 阶段 4 UI 壳（进行中 → 下一目标）
- [ ] 阶段 2 插件契约 + demo
- [ ] 阶段 3 CLI 宿主
- [ ] 阶段 4 UI 壳
- [ ] 阶段 5 测试 + 定稿

---

## 阶段总览

| 阶段 | 效果（做完你能看到什么） | 主要组件 | git |
|---|---|---|---|
| 0 地基 | 仓库能 clone、装依赖、构建 | workspaces / tsconfig / .gitignore / LICENSE / README | init → 首提 → GitHub → push |
| 1 内核核心 | 能加载插件、插件能注册/查询能力 | @minex/kernel：registry / events / storage / lifecycle / kernel | 每原语一提交，tag v0.1.0 |
| 2 插件契约+demo | 完整生命周期；demo 插件全流程验证 | manifest / loader / plugin-api / reload / demo-plugin | tag v0.2.0 |
| 3 CLI 宿主 | 无 UI 也能用内核（Project 2 测功能层的地基） | @minex/cli：加载、执行命令、读写设置 | tag v0.3.0 |
| 4 UI 壳 | 图形界面显示插件贡献（外观参考 Cherry Studio） | @minex/ui-shell：布局 / 槽位 / schema 设置表单 / 事件刷新 | tag v0.4.0 |
| 5 测试+定稿 | 内核稳定、关键路径有测试、文档齐全 | vitest 测试套件 / docs/design.md 定稿 / README | tag v1.0.0 |

> 顺序说明：CLI 在 UI 之前——因为「无 UI 能用内核」是功能层（Project 2）的地基，且 CLI 比 UI 快、先验证逻辑再加表现。UI 壳的外观风格以 Cherry Studio 为视觉参考，代码自己写。

---

## 阶段 0 · 地基

- **效果**：`git clone` 后 `npm install` 能跑通，空骨架能构建。
- **组件**：
  - 根 `package.json`（npm workspaces：packages/kernel、ui-shell、cli、demo-plugin）
  - `tsconfig.json`（统一 TS 配置）
  - `.gitignore`（Node 模板 + Vite 缓存 + 插件产物）
  - `LICENSE`（MIT）
  - `README.md`（一句话介绍 + 结构图）
- **验收**：空目录能构建（`tsc --noEmit` 通过）。
- **git**：`git init` → 首次提交 → GitHub 建仓（选 Node 模板）→ push。tag `v0.0.1`。

## 阶段 1 · 内核核心

- **效果**：一个最小脚本能「加载插件 → 插件 activate → 注册能力 → query 查到它」。
- **组件**（@minex/kernel，纯 TS，领域无关）：
  - `registry.ts` —— 能力注册表（register/query/get/unregister，priority，{plugin} 过滤，onChange）
  - `events.ts` —— 事件总线（emit/on/off）
  - `storage.ts` —— 命名空间存储（get/set/delete/list，JSON 文件实现，可替换）
  - `lifecycle.ts` —— 插件状态机（discovered/loaded/activated/deactivated）
  - `kernel.ts` —— 组装四件套，暴露两套 API（插件视图 / 宿主视图）
- **验收**：`npm run test:kernel`（vitest）通过：注册→查询→过滤→priority 覆盖→事件通知。
- **git**：四个原语各一提交；tag `v0.1.0`，push。

## 阶段 2 · 插件契约 + demo

- **效果**：demo 插件的静态贡献（manifest）在激活前就可用；动态注册激活后可用；reload 生效；`reloadable:false` 被正确跳过。
- **组件**：
  - `manifest.ts` —— manifest 解析 + 校验（id/version/minKernelVersion/dependencies/settingsSchema/contributes）
  - `loader.ts` —— 动态 `import()` 加载插件入口
  - `plugin-api.ts` —— `activate(ctx)` 的 ctx：register/query/get/on/emit/storage/log
  - `reload.ts` —— 停用→激活；跳过 reloadable:false
  - `demo-plugin/` —— 注册 1 个 UI 贡献 + 1 个命令 + 1 个设置项（三条通道各验一次）
- **验收**：CLI 脚本演示全流程；设置值存了能读回来；reload 后贡献刷新。
- **git**：每小块一提交；tag `v0.2.0`，push。

## 阶段 3 · CLI 宿主

- **效果**：命令行能 `minex run demo.sayHello` 执行插件命令、`minex config get/set` 读写设置。
- **组件**（@minex/cli）：`main.ts`、命令路由、插件加载、输出格式。
- **验收**：CLI 加载 demo → 执行命令 → 读设置生效。
- **git**：tag `v0.3.0`，push。

## 阶段 4 · UI 壳

- **效果**：图形界面启动后，demo 插件的贡献显示在槽位；设置表单能改能存；命令能点。外观参考 Cherry Studio。
- **组件**（@minex/ui-shell，React）：
  - 布局（左栏 / 主区 / 顶栏）—— 内核固定，插件往槽位填内容
  - 槽位渲染器 —— `host.registry.query("ui", {location})` → 渲染
  - schema 设置表单 —— 读 `settingsSchema` → 生成表单 → 写存储
  - 事件刷新 —— 订阅 `contribution:changed` / `data:changed` 自动刷新
- **验收**：四点验收标准跑通（见 roadmap 顶部「效果」）。
- **git**：tag `v0.4.0`，push。

## 阶段 5 · 测试 + 定稿

- **效果**：核心路径有测试覆盖，设计文档定稿，README 完整。
- **组件**：vitest 测试套件（加载/注册/查询/存储/重载）、`docs/design.md` 定稿、README。
- **验收**：`npm test` 全绿；design.md 与代码一致。
- **git**：tag `v1.0.0`，push。**Project 1 完成。**

---

## git 同步与流程约定

1. **提交纪律**：每个「完成一个小功能」一次提交，消息写清做了什么（如 `feat(kernel): add capability registry`）。
2. **分支策略**：简单流——主分支直接推进；只有较大改动才开 feature 分支。
3. **同步节奏**：每阶段结束 push 一次（备份 + 你 review）。
4. **版本**：tag 按阶段递增（v0.0.1 → v0.1.0 → … → v1.0.0）。
5. **你的审核点**：每个阶段 push 后，你看 diff 说「通过」→ 我进下一阶段。这是你的设计/审核工作。
6. **密钥纪律**：`.env*` 永不提交；API 密钥只放本地环境。

---

## 下一步（阶段 0 具体动作）

1. 你在 GitHub 建 `minex` 仓库（选 Node 模板，MIT 或 None 都行），把地址给我；
2. 我执行：git init → 写 .gitignore/LICENSE/README/package.json/tsconfig → 首提 → 关联 remote → push。
