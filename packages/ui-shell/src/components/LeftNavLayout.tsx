import type { ReactNode } from "react";

/**
 * 可复用左栏布局（F6，反馈 6）：全屏工具页的固定左栏。
 * 固定语义内置 = 「不给机制」：组件不提供右键拆放 / 双击浮起 / 面板 tab / dockState——
 * 页面导航永远固定；面板池的可拆放属 WorkspaceInstance（P2 不回归）。二者边界见
 * agent-mainline-plan.md §八 决策记录（F6 扩展点声明：阶段 3/4 全屏工具页一律套用本组件）。
 */
export function LeftNavLayout({
  title,
  onBack,
  nav,
  main,
  width = 200,
}: {
  title?: string; // 左栏顶部标题（如「设置」）
  onBack?: () => void; // 左栏顶部返回按钮（可选，不传不显示）
  nav?: ReactNode; // 左栏导航内容（导航项由调用方渲染；无导航的页可省略，如驱动详情页）
  main: ReactNode; // 主体内容
  width?: number; // 左栏宽（默认 200）
}) {
  return (
    <div className="leftnav-layout">
      <div className="leftnav" style={{ width }}>
        {(title || onBack) && (
          <div className="leftnav-head">
            {onBack && (
              <button className="icon-btn" onClick={onBack} title="返回">
                ← 返回
              </button>
            )}
            {title && <strong>{title}</strong>}
          </div>
        )}
        {nav}
      </div>
      <div className="leftnav-main">{main}</div>
    </div>
  );
}
