import { useKernel } from "../kernel-context.js";

interface UiContribution {
  id: string;
  location?: string;
  title?: string;
}

export function Sidebar({
  selectedPanelId,
  onSelect,
  problems,
}: {
  selectedPanelId: string | null;
  onSelect: (id: string) => void;
  problems: string[];
}) {
  const kernel = useKernel();
  const drivers = kernel.drivers.list();
  const leftItems = kernel.registry
    .query<UiContribution>("ui")
    .filter((c) => c.value.location === "leftPanel");

  return (
    <aside className="sidebar">
      <div className="section-title">驱动</div>
      {drivers.map((p) => (
        <div key={p.manifest.id} className="list-item">
          <span>{p.manifest.name}</span>
          <span className="muted">{p.manifest.version}</span>
        </div>
      ))}
      {problems.map((p) => (
        <div key={p} className="muted" style={{ padding: "4px 12px" }}>
          ⚠ {p}
        </div>
      ))}

      <div className="section-title" style={{ marginTop: 16 }}>
        面板
      </div>
      {leftItems.length === 0 && <div className="muted">（无面板贡献）</div>}
      {leftItems.map((c) => (
        <div
          key={c.id}
          className={`list-item${selectedPanelId === c.id ? " active" : ""}`}
          onClick={() => onSelect(c.id)}
        >
          {c.value.title ?? c.value.id}
        </div>
      ))}
    </aside>
  );
}
