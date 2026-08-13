# Appearance Driver（外观驱动）

Minex 的外观管理驱动——管理主题、定制全局外观。

## 功能

- **主题管理**：浏览已有主题、双击打开主题选项卡进行个性化设置。
- **全局设置**：颜色（主题色/背景色/提示色/警告色）、字体（中文/英文）、图标体系。
- **主题贡献**：把当前主题的 CSS 变量注入外壳（浅色 `:root` / 深色 `[data-theme="dark"]`）。

## 工作原理

外观驱动是 Minex 的「图形界面必需」驱动，随软件自带。它监听 `minex:dataChanged` 事件，设置保存后即时重注册主题 CSS，外壳的主题管理器（ThemeManager）随即重新应用。

## 架构位置

```
内核（registry/events/storage/lifecycle）
  ↑ 贡献 theme（CSS）+ settingsView（React 组件）
外观驱动
  ↓ 消费
外壳 ui-shell（ThemeManager 注入 CSS / DriverDetail 渲染 settingsView）
```

## 说明

- 其他驱动的外观设置（如 markdown 编辑器驱动的代码块样式）也由本驱动统一处理——它们通过「驱动设置」扩展点接入（后续落地）。
- 主题商店 / 市场（下载主题、赞助作者）属后续里程碑。
