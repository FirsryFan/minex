# Minex

领域无关的插件宿主内核（微内核架构）。

Minex 是一个极轻量的插件化应用外壳：内核只提供**插件生命周期、能力注册表、事件总线、存储**四个原语，不绑定任何领域——agent、对话、知识库、PDF 查看器都可以作为插件装进来。

## 结构

| 包 | 说明 | 状态 |
|---|---|---|
| `packages/kernel` | Minex 内核（纯 TS，领域无关） | 阶段 0 骨架 |
| `packages/cli` | CLI 宿主（无 UI 也能用内核） | 阶段 3 |
| `packages/ui-shell` | UI 壳（React：布局 + 槽位 + 设置表单） | 阶段 4 |
| `packages/demo-plugin` | demo 插件（测试夹具） | 阶段 2 |

## 开发

```bash
npm install        # 安装依赖
npm run typecheck  # 类型检查
npm run build      # 构建全部包
npm test           # 运行测试
```

## 使用（CLI）

先准备（在项目根目录 `E:\Minex` 执行）：

```bash
npm run build          # 构建 kernel + demo + cli
npm run plugins:sync   # 把 demo 同步到 plugins/minex.demo
```

然后测试（两种方式等价）：

```bash
# 方式一：npm 脚本（每次自动重新构建 cli，最稳）
npm run cli -- run demo.sayHello Minex
npm run cli -- config set minex.demo config '{"greeting":"你好"}'
npm run cli -- plugins list

# 方式二：直接 node（构建后更快）
node packages/cli/dist/cli.js run demo.sayHello Minex
```

**注意**：必须在项目根目录运行（CLI 默认加载 `./plugins`、数据存 `./.minex-data`）。设置文件在 `E:\Minex\.minex-data\minex.demo.json`，可手动查看。

## 路线图

见 [docs/roadmap.md](docs/roadmap.md)。
