import { useKernel } from "../kernel-context.js";

interface UiContribution {
  id: string;
  location?: string;
  title?: string;
}

export function MainArea({
  collapsed,
  onToggleLeft,
  onToggleRight,
  selectedPanelId,
  commandResult,
}: {
  collapsed: { left: boolean; right: boolean };
  onToggleLeft: () => void;
  onToggleRight: () => void;
  selectedPanelId: string | null;
  commandResult: string | null;
}) {
  const kernel = useKernel();
  const panel = selectedPanelId
    ? kernel.registry.get<UiContribution>("ui", selectedPanelId)
    : undefined;

  return (
    <main className="main">
      {/* 顶条：折叠按钮在主区顶条左右两侧 */}
      <div className="main-strip">
        <button className="icon-btn" onClick={onToggleLeft}>
          {collapsed.left ? "左栏 ▸" : "◂ 左栏"}
        </button>
        <span className="muted">{panel ? panel.value.title ?? selectedPanelId : "Minex"}</span>
        <button className="icon-btn" onClick={onToggleRight}>
          {collapsed.right ? "◂ 右栏" : "右栏 ▸"}
        </button>
      </div>

      <div className="main-content">
        {panel ? (
          <div className="card">
            <h3>{panel.value.title}</h3>
            <p className="muted">
              id: {panel.value.id} · location: {panel.value.location}
            </p>
            <p style={{ marginTop: 8 }}>
              来自插件的 UI 贡献已渲染到主区。具体的插件组件渲染将在后续版本支持。
            </p>
          </div>
        ) : commandResult ? (
          <div className="card">
            <div className="section-title">命令结果</div>
            <pre style={{ whiteSpace: "pre-wrap" }}>{commandResult}</pre>
          </div>
        ) : (
          <div className="card muted">
            Minex UI 壳 —— 从左侧选择面板，或从右侧运行命令。
          </div>
        )}
      </div>
    </main>
  );
}
