import { useKernel } from "../kernel-context.js";

interface UiContribution {
  id: string;
  location?: string;
  title?: string;
}

/**
 * 主区 = 视图槽位。具体视图（画布 / 对话 / 面板内容）属于驱动，
 * 外壳只显示占位，不实现任何特定视图。
 */
export function MainArea({
  collapsed,
  onToggleLeft,
  onToggleRight,
  selectedPanelId,
}: {
  collapsed: { left: boolean; right: boolean };
  onToggleLeft: () => void;
  onToggleRight: () => void;
  selectedPanelId: string | null;
}) {
  const kernel = useKernel();
  const panel = selectedPanelId
    ? kernel.registry.get<UiContribution>("ui", selectedPanelId)
    : undefined;

  return (
    <main className="main">
      {/* 顶条：折叠按钮在主区顶条左右两侧 */}
      <div className="main-strip">
        <button className="icon-btn" title="折叠左栏" onClick={onToggleLeft}>
          {collapsed.left ? "»" : "«"}
        </button>
        <span className="muted">{panel ? panel.value.title ?? selectedPanelId : "Minex"}</span>
        <button className="icon-btn" title="折叠右栏" onClick={onToggleRight}>
          {collapsed.right ? "«" : "»"}
        </button>
      </div>

      <div className="main-content">
        <div className="card muted">
          {panel
            ? `已选择视图：${panel.value.title ?? panel.value.id} —— 视图渲染由驱动贡献，外壳不实现具体视图。`
            : "Minex 通用外壳 —— 主区是视图槽位，画布/对话等驱动视图将在此渲染。"}
        </div>
      </div>
    </main>
  );
}
