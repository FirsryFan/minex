export function TopBar({
  pluginCount,
  onOpenSettings,
}: {
  pluginCount: number;
  onOpenSettings: () => void;
}) {
  return (
    <header className="topbar">
      <span style={{ fontWeight: 700, fontSize: 16 }}>Minex</span>
      <span className="muted">{pluginCount} 个插件</span>
      <span style={{ flex: 1 }} />
      <button className="btn-ghost" onClick={onOpenSettings}>
        设置
      </button>
    </header>
  );
}
