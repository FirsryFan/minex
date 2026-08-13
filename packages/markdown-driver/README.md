# Markdown 编辑器

Minex 的 Markdown 编辑与渲染驱动。

## 功能

- **三种模式**：纯编辑 / 纯预览 / 分屏（左编辑右预览）
- **实时渲染**：基于 `marked` 的 markdown 渲染
- **通用渲染能力**：贡献 `markdown.render` 能力，供其他驱动（如外观驱动的 README 显示）复用

## 工作原理

本驱动贡献三样东西给内核：

1. `markdown.render` —— 通用 markdown → HTML 渲染函数（纯函数，任何需要渲染 markdown 的地方可复用）
2. `workspace` —— 工作区视图（编辑区 + 预览区 + 模式切换）
3. `settingsView` —— 编辑器设置（代码块字体等）

## 架构位置

```
内核（registry/events/storage/lifecycle）
  ↑ 贡献 markdown.render + workspace + settingsView
markdown 驱动
  ↑ 供复用
其他驱动（appearance README 显示等）
```

## 说明

- v1 编辑区用纯 `<textarea>`（支持代码块编辑，非专业代码编辑器）
- 文件读写（打开/保存 .md 文件）留待 Electron 桌面版落地
