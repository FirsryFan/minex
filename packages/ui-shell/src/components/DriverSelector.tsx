import { useEffect, useRef, useState } from "react";

interface DriverOption {
  id: string;
  name: string;
  icon?: string;
}

/** 顶栏左上角驱动选择器：下拉按钮 + 滚动菜单 + 搜索 */
export function DriverSelector({
  drivers,
  activeDriverId,
  onSelect,
}: {
  drivers: DriverOption[];
  activeDriverId: string | null;
  onSelect: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  // 点外部关闭 + Esc 关闭
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDoc);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDoc);
    };
  }, [open]);

  const q = query.trim().toLowerCase();
  const filtered = q
    ? drivers.filter((d) => d.name.toLowerCase().includes(q) || d.id.toLowerCase().includes(q))
    : drivers;

  return (
    <div className="driver-selector" ref={ref}>
      <button className="driver-selector-btn" onClick={() => setOpen((o) => !o)} title="选择驱动">
        ☰
      </button>
      {open && (
        <div className="dropdown">
          <input
            className="dropdown-search"
            placeholder="搜索驱动…"
            value={query}
            autoFocus
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className="dropdown-list">
            {filtered.length === 0 && <div className="muted" style={{ padding: 8 }}>（无匹配驱动）</div>}
            {filtered.map((d) => (
              <div
                key={d.id}
                className={`dropdown-item${d.id === activeDriverId ? " active" : ""}`}
                onClick={() => {
                  onSelect(d.id);
                  setOpen(false);
                  setQuery("");
                }}
              >
                <span className="driver-icon">{d.icon ?? "📦"}</span>
                <span>{d.name}</span>
                <span className="muted">{d.id}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
