import type { MinexKernel } from "@minex/kernel";
import { useState } from "react";
import readme from "../README.md?raw";

interface Theme {
  id: string;
  name: string;
  version: string;
  author: string;
  mode: "light" | "dark";
  preview?: string;
  readOnly?: boolean;
  settings?: Record<string, unknown>;
}

const GLOBAL_COLORS = [
  { key: "primaryColor", label: "主题色" },
  { key: "backgroundColor", label: "背景色" },
  { key: "warningColor", label: "提示色" },
  { key: "dangerColor", label: "警告色" },
];
const EN_FONTS = ["Arial", "Georgia", "Times New Roman", "Verdana", "Tahoma", "Trebuchet MS", "Segoe UI", "Roboto", "Open Sans", "Courier New", "Consolas"];
const ZH_FONTS = ["PingFang SC", "Microsoft YaHei", "SimHei", "SimSun", "Songti SC", "KaiTi", "FangSong", "Noto Sans CJK SC", "Source Han Sans SC"];
const ICON_THEMES = ["默认", "简约"];

const DEFAULT_THEMES: Theme[] = [
  {
    id: "default-light", name: "默认浅色", version: "1.0.0", author: "Minex", mode: "light",
    settings: { primaryColor: "#2563eb", backgroundColor: "#f3f6fb", warningColor: "#f59e0b", dangerColor: "#ef4444", zhFont: "Microsoft YaHei", enFont: "Arial", iconTheme: "默认" },
  },
  {
    id: "default-dark", name: "默认深色", version: "1.0.0", author: "Minex", mode: "dark",
    settings: { primaryColor: "#3b82f6", backgroundColor: "#0f172a", warningColor: "#f59e0b", dangerColor: "#ef4444", zhFont: "Microsoft YaHei", enFont: "Arial", iconTheme: "默认" },
  },
];

const THEMES_KEY = "themes";

interface Tab {
  id: string;
  label: string;
  closable?: boolean;
}

export default function SettingsView({ kernel }: { kernel: MinexKernel }) {
  const [tabs, setTabs] = useState<Tab[]>([
    { id: "about", label: "介绍" },
    { id: "manage", label: "管理主题" },
  ]);
  const [activeTab, setActiveTab] = useState("about");
  const [themes, setThemes] = useState<Theme[]>(() => {
    const saved = kernel.storage.namespace("minex.appearance").get<Theme[]>(THEMES_KEY);
    return saved && saved.length > 0 ? saved : DEFAULT_THEMES;
  });

  function persistThemes(next: Theme[]): void {
    kernel.storage.namespace("minex.appearance").set(THEMES_KEY, next);
    setThemes(next);
    kernel.events.emit("minex:dataChanged", { driverId: "minex.appearance" });
  }

  // 双击主题 → 打开新选项卡（可关闭），不原地叠加
  function openTheme(theme: Theme): void {
    const tabId = `theme:${theme.id}`;
    setTabs((prev) => (prev.some((t) => t.id === tabId) ? prev : [...prev, { id: tabId, label: theme.name, closable: true }]));
    setActiveTab(tabId);
  }
  function closeTab(id: string): void {
    setTabs((prev) => {
      const next = prev.filter((t) => t.id !== id);
      if (activeTab === id) setActiveTab(next.length > 0 ? next[next.length - 1].id : "manage");
      return next;
    });
  }

  const activeTheme = activeTab.startsWith("theme:")
    ? themes.find((t) => `theme:${t.id}` === activeTab)
    : undefined;

  return (
    <div>
      <div className="detail-tabs">
        {tabs.map((t) => (
          <span key={t.id} className={`detail-tab${activeTab === t.id ? " active" : ""}`} onClick={() => setActiveTab(t.id)}>
            {t.label}
            {t.closable && (
              <span
                className="tab-close"
                onClick={(e) => {
                  e.stopPropagation();
                  closeTab(t.id);
                }}
              >
                ×
              </span>
            )}
          </span>
        ))}
      </div>

      {activeTab === "about" && (
        <div className="card readme-card">
          <pre style={{ whiteSpace: "pre-wrap", fontFamily: "var(--font-content)" }}>{readme}</pre>
        </div>
      )}
      {activeTab === "manage" && <ThemeGrid themes={themes} onOpen={openTheme} />}
      {activeTheme && (
        <ThemeSettings
          theme={activeTheme}
          onSave={(settings) => {
            persistThemes(themes.map((t) => (t.id === activeTheme.id ? { ...t, settings } : t)));
          }}
        />
      )}
    </div>
  );
}

function ThemeGrid({ themes, onOpen }: { themes: Theme[]; onOpen: (t: Theme) => void }) {
  return (
    <div className="theme-grid">
      <div className="theme-card theme-add" title="主题商店">
        <div className="theme-add-plus">＋</div>
      </div>
      {themes.map((t) => (
        <div key={t.id} className="theme-card" onDoubleClick={() => onOpen(t)} title={t.name}>
          <div className="theme-preview">
            <div className="theme-preview-placeholder">{t.mode === "dark" ? "深色" : "浅色"}</div>
          </div>
          <div className="theme-meta">
            <span className="theme-name">{t.name}</span>
            <span className="muted">v{t.version} · {t.author}</span>
          </div>
          {t.readOnly && <span className="theme-readonly">只读</span>}
        </div>
      ))}
    </div>
  );
}

function ThemeSettings({
  theme,
  onSave,
}: {
  theme: Theme;
  onSave: (settings: Record<string, unknown>) => void;
}) {
  const [settings, setSettings] = useState<Record<string, unknown>>(theme.settings ?? {});
  const readonly = theme.readOnly === true;

  function setField(key: string, value: unknown): void {
    const next = { ...settings, [key]: value };
    setSettings(next);
    if (!readonly) onSave(next);
  }

  return (
    <div className="card">
      <div className="section-title">颜色设置</div>
      {GLOBAL_COLORS.map((c) => (
        <div className="field" key={c.key}>
          <label>{c.label}</label>
          <div className="field-control">
            <ColorField value={String(settings[c.key] ?? "#000000")} disabled={readonly} onChange={(v) => setField(c.key, v)} />
          </div>
        </div>
      ))}

      <div className="section-title">字体设置</div>
      <FontRow label="全局中文" fonts={ZH_FONTS} value={String(settings.zhFont ?? "")} readonly={readonly} onChange={(v) => setField("zhFont", v)} />
      <FontRow label="全局英文" fonts={EN_FONTS} value={String(settings.enFont ?? "")} readonly={readonly} onChange={(v) => setField("enFont", v)} />

      <div className="section-title">图标设置</div>
      <div className="field">
        <label>图标体系</label>
        <div className="field-control">
          <select value={String(settings.iconTheme ?? "默认")} disabled={readonly} onChange={(e) => setField("iconTheme", e.target.value)}>
            {ICON_THEMES.map((o) => (
              <option key={o} value={o}>{o}</option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
}

/** 颜色选择：色块点击展开，内部滑块拖动调节（非系统取色器） */
function ColorField({ value, disabled, onChange }: { value: string; disabled: boolean; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const r = Number.parseInt(value.slice(1, 3), 16) || 0;
  const g = Number.parseInt(value.slice(3, 5), 16) || 0;
  const b = Number.parseInt(value.slice(5, 7), 16) || 0;
  function toHex(n: number): string {
    return Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
  }
  return (
    <div className="color-field">
      <button className="color-swatch" style={{ background: value }} disabled={disabled} onClick={() => setOpen((o) => !o)} />
      {open && !disabled && (
        <div className="color-popover">
          {(["r", "g", "b"] as const).map((ch, i) => {
            const v = [r, g, b][i];
            return (
              <label key={ch} className="color-slider">
                <span>{ch.toUpperCase()}</span>
                <input
                  type="range"
                  min={0}
                  max={255}
                  value={v}
                  onChange={(e) => {
                    const n = Number(e.target.value);
                    const arr = [r, g, b];
                    arr[i] = n;
                    onChange(`#${toHex(arr[0])}${toHex(arr[1])}${toHex(arr[2])}`);
                  }}
                />
                <span className="muted">{v}</span>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}

function FontRow({
  label,
  fonts,
  value,
  readonly,
  onChange,
}: {
  label: string;
  fonts: string[];
  value: string;
  readonly: boolean;
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="field">
      <label>{label}</label>
      <div className="field-control">
        <div className="driver-selector">
          <button className="select-btn" disabled={readonly} onClick={() => setOpen((o) => !o)}>
            <span style={{ fontFamily: value ? `"${value}"` : undefined }}>{value}</span>
          </button>
          {open && (
            <div className="dropdown">
              <div className="dropdown-list">
                {fonts.map((f) => (
                  <div
                    key={f}
                    className="dropdown-item"
                    onClick={() => {
                      onChange(f);
                      setOpen(false);
                    }}
                  >
                    <span style={{ fontFamily: `"${f}"` }}>{f}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
