export function TopBar({
  driverCount,
  onOpenSettings,
}: {
  driverCount: number;
  onOpenSettings: () => void;
}) {
  return (
    <header className="topbar">
      <span style={{ fontWeight: 700, fontSize: 16 }}>Minex</span>
      <span className="muted">{driverCount} 个驱动</span>
      <span style={{ flex: 1 }} />
      <button className="btn-ghost" onClick={onOpenSettings}>
        设置
      </button>
    </header>
  );
}
