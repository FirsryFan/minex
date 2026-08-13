# Minex 项目交接文档（给项目子 agent）

> 这份文档让接手者**不读历史对话**也能理解项目全貌、当前状态、下一步任务、必须遵守的工作流程。
> 仓库：https://github.com/FirsryFan/minex　本地：`E:\Minex`

---

## 一、项目是什么

Minex 是一个**领域无关的插件宿主内核（微内核架构）**，用 TypeScript 写的 AI Agent 平台。核心思想：**内核只提供「机制」，一切「内容」归驱动（插件）、一切「表现」归 UI 外壳**。

架构三层：

```
内核 @minex/kernel   机制：registry / events / storage / lifecycle（领域无关，不认识 agent/tool/theme 等任何概念）
外壳 @minex/ui-shell 顶栏 + 设置页 + 主题系统 + 工作区布局 + 三段布局
驱动 packages/*-driver 功能（filesystem / markdown / appearance）
```

**术语**：插件统一叫「驱动（Driver）」。驱动 = 功能模块，类比设备驱动——没有它软件没有功能。

---

## 二、内核（@minex/kernel）

四个原语，均已实现并有测试：

| 原语 | 文件 | 职责 |
|---|---|---|
| 生命周期 | `src/lifecycle.ts` | 状态机 discovered→activated→deactivated/failed；依赖先激活；失败回滚（激活 session）；reload |
| 能力注册表 | `src/registry.ts` | 按 type 注册/查询；**分层**（static/runtime 两层，effective=runtime??static）；priority 覆盖（同优先级不同插件先到者胜，同插件重注册=更新） |
| 事件总线 | `src/events.ts` | emit/on/off；emit 期间安全退订 |
| 存储 | `src/storage.ts` | 命名空间 KV；内存实现 + JSON 文件实现（原子写） |

**最关键的一个坑（务必记住）**：

```
kernel.registry.query<T>()  返回 Contribution<string,T>[]  ← 宿主视图，取数据要 .map(c => c.value)
kernel.registry.get<T>()    返回 Contribution<string,T> | undefined ← 同上，要 .value
ctx.query<T>()              返回 T[]                        ← 受限视图（驱动视图），已剥元数据
ctx.get<T>()                返回 T | undefined              ← 同上
```

**驱动侧（activate(ctx) 里）用 ctx；外壳/宿主侧用 kernel.registry。扩展点消费方（宿主侧）最容易漏 `.value`**——历史上因为这个 bug 崩过两次。

内核版本 `MINEX_KERNEL_VERSION = "0.2.3"`。

---

## 三、外壳（@minex/ui-shell）

- **顶栏**：驱动选择器（只列 `hasWorkspace: true` 的驱动）+ 深/浅色切换 + 设置按钮。
- **设置页**（全屏）：左栏文件夹导航 + 驱动管理（暂存式启用/禁用 + 依赖警告）+ 驱动详情。
- **主题系统**：驱动贡献 `theme`（CSS 覆盖块），`ThemeManager` 注入 `<style id="minex-driver-theme">`；深/浅模式用 `[data-theme="dark"]` 覆盖。
- **三段布局**（`src/App.tsx`）：侧边栏 / 主体 / 右栏，**各自可被驱动贡献替换**：
  - 侧边栏：查 `sidebar` 贡献（文件系统驱动的文件树常驻），无则默认 Sidebar
  - 主体：查活动驱动的 `workspace` 贡献，无则默认 MainArea
  - 右栏：空槽位 RightBar
- **驱动贡献机制**（均用 `lazy + Suspense`，**lazy 必须 useMemo**）：
  - `settingsView`：驱动自定义设置界面（DriverDetail 消费）
  - `workspace`：驱动工作区（App 主体消费）
  - `sidebar`：驱动侧边栏（App 左栏消费）
  - `theme`：驱动主题 CSS（ThemeManager 消费）

**存储适配器**：浏览器用 `createLocalStorageStorage`（`src/storage-local.ts`，key 编码用 `name:encodeURIComponent(key)`）；Node/CLI 用 JSON 文件。

---

## 四、现有驱动（3 个）

| 驱动 | id | 贡献 |
|---|---|---|
| **filesystem** | `minex.filesystem` | `filesystem` 能力（readDir/readFile/writeFile，路径安全）+ `sidebar` 文件树 + `workspace` |
| **markdown** | `minex.markdown` | `markdown.render` 通用渲染（highlight.js + KaTeX）+ `theme`（--font-md/--md-code-wrap 等）+ `workspace`（四模式编辑）+ `settingsView` |
| **appearance** | `minex.appearance` | `theme`（浅/深/全局三份 CSS）+ `settingsView`（主题管理）+ `appearance.driverSetting` 扩展点 |

**驱动间依赖**：appearance `dependencies: ["minex.markdown"]`（README 用 markdown.render 渲染）。DRIVERS 数组顺序：filesystem → markdown → appearance（依赖在前）。

**跨驱动复用示例**（`markdown.render` 被 appearance 消费）：
```
markdown 驱动 ──register("markdown","render",{render})──► registry
                                                          ▲
appearance 驱动 ──get("markdown","render")──► render(readme) ─┘
```

---

## 五、工作流程（硬性，违反会出大问题）

1. **只写代码 + 文档，不自行跑构建/测试/验证**——验证由外部 agent 执行，避免污染上下文。
2. **每轮结束写 `docs/report-NN.md`**，固定四节：
   ① 上次修改结果 + 代码定位（`file:line`）　② 本轮目标　③ 实现文件与数据流　④ 审查标准 + 已知限制
3. **纯逻辑必须抽纯函数 + 自动化测试**（每个纯函数 ≥3 用例：正常+边界+冲突）。UI 组件层不承载可测逻辑。
4. **验证命令固定三连**：`npm run typecheck && npm run build && npm test`，**typecheck 是提交前置硬门槛**。历史上验证 agent 多次只跑 test 漏掉类型错误——报告里要强调「贴回三个命令的完整输出」。
5. git 小步提交 + push；报告编号每轮递增（当前 report-20 已出，下一份 report-21）。

### 已踩过的坑（务必避免重犯）

- **React Hooks 规则**：所有 hooks（useState/useEffect/useMemo）必须在条件 return 之前；`lazy()` 必须 `useMemo`（组件体内新建 lazy 会导致每次渲染重挂载、状态重置——曾导致「设置页卡死」和「设置界面被踢回」）。
- **setState updater 内禁副作用**（写 storage/emit 事件），用 `useRef` 存最新值，副作用移出 updater。
- **宿主视图 `.value`**：见上文第二节。
- **React state 不可变**：不要直接改对象属性再 `setState([...arr])`，用函数式更新 + 递归 map。
- **字符串字面量不能含真实换行**（测试里 `"```ts\n..."` 要用 `\n` 转义，不能写真实换行）。

---

## 六、当前进度（刚做完的事）

- 文件系统驱动**第一批**已完成并推送（tag 无，commit `30e0dbc`）：
  - `packages/filesystem-driver/`：`path.ts`（路径安全纯函数 + 8 测试）、`fs.ts`（FileSystemAbility + 浏览器 File System Access API 实现）、`index.ts`（注册 filesystem/sidebar/workspace）、`sidebar-view.tsx`（文件树）、`workspace-view.tsx`（占位）
  - 外壳 App 重构为三段布局，`sidebar` 贡献常驻左栏
- 文件系统驱动 **README 未写**（manifest 里 description 有，但没有 README.md）

---

## 七、下一步任务（按优先级）

### 任务 1（当前进行中）：markdown 适配 filesystem

让 markdown 编辑器能打开文件树里的 `.md` 文件：

1. 文件树点击 `.md` 文件 → 通过 `filesystem` 能力 `readFile(path)` 读内容 → 传给 markdown 驱动。
2. 实现方式建议：文件树点击文件时 `emit` 一个事件（如 `filesystem:openFile { path }`），markdown 驱动的 workspace-view 订阅该事件，读到内容后显示到编辑器。
3. markdown 编辑保存时写回：`writeFile(path, content)`。
4. markdown 驱动加 `dependencies: ["minex.filesystem"]`。

**验收**：点击文件树 .md 文件 → markdown 编辑器显示内容；编辑 → 保存 → 文件树刷新/文件更新。

### 任务 2：文件系统驱动补 README.md

按 appearance/markdown 的 README 风格写，说明能力与用法。

### 后续方向（按学员规划）

- 文件系统 Node/Electron 实现（桌面版落地，接口已抽象在 `FileSystemAbility`）
- 文件图标体系接 appearance（现在是 emoji 硬编码）
- **agent 驱动**（对话 + agent loop，用书的 Ch5 工具调用等模式）——这是平台核心价值，但学员要求「先打磨好已有 + 用尽内核接口」再转向
- 大板块（需单独讨论设计）：链接系统（Obsidian 式）、非线性视图

---

## 八、快速上手命令

```bash
cd /e/Minex
npm install
npm run typecheck && npm run build && npm test   # 三连
npm run ui                                        # 启动（浏览器 http://localhost:5173）
npm run drivers:sync                              # 同步驱动到 drivers/（CLI/Electron 用）
```

---

## 九、关键文件索引

- 内核：`packages/kernel/src/{kernel,registry,lifecycle,events,storage,types,loader,manifest}.ts`
- 外壳：`packages/ui-shell/src/{App.tsx,drivers.ts,storage-local.ts}` + `components/{DriverDetail,SettingsPage,ThemeManager,TopBar,...}`
- 驱动：`packages/{filesystem,markdown,appearance}-driver/src/index.ts`（各驱动的入口 + 纯函数）
- 测试：各包 `test/*.test.ts`
- 文档：`docs/{roadmap,driver-architecture,report-NN,review-phaseNN-report}.md`
