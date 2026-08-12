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
npm run build      # 构建内核
```

## 路线图

见 [docs/roadmap.md](docs/roadmap.md)。
