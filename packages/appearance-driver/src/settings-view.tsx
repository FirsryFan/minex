import type { MinexKernel } from "@minex/kernel";
import { useEffect, useRef, useState } from "react";
import readme from "../README.md?raw";
import { hexToHsv, hsvToHex, type Hsv } from "./color.js";
import { DEFAULT_THEMES, THEMES_KEY, type Theme } from "./theme.js";

const GLOBAL_COLORS = [
  { key: "primaryColor", label: "主题色" },
  { key: "backgroundColor", label: "背景色" },
  { key: "warningColor", label: "提示色" },
  { key: "dangerColor", label: "警告色" },
];
const EN_FONTS = ["Arial", "Georgia", "Times New Roman", "Verdana", "Tahoma", "Trebuchet MS", "Segoe UI", "Roboto", "Open Sans", "Courier New", "Consolas"];
const ZH_FONTS = ["PingFang SC", "Microsoft YaHei", "SimHei", "SimSun", "Songti SC", "KaiTi", "FangSong", "Noto Sans CJK SC", "Source Han Sans SC"];
const ICON_THEMES = ["默认", "简约"];

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

  function persistThemes(updater: (prev: Theme[]) => Theme[]): void {
    setThemes((prev) => {
      const next = updater(prev); // 函数式更新，避免闭包旧值
      kernel.storage.namespace("minex.appearance").set(THEMES_KEY, next);
      kernel.events.emit("minex:dataChanged", { driverId: "minex.appearance" });
      return next;
    });
  }

  // 双击主题 → 打开新选项卡（可关闭），不原地叠加
  function openTheme(theme: Theme): void {
    const tabId = `theme:${theme.id}`;
    setTabs((prev) => (prev.some((t) => t.id === tabId) ? prev : [...prev, { id: tabId, label: theme.name, closable: true }]));
    setActiveTab(tabId);
  }
  function closeTab(id: string): void {
    // M1：拆两个独立 setState（不在 updater 内做副作用）
    const next = tabs.filter((t) => t.id !== id);
    setTabs(next);
    if (activeTab === id) setActiveTab(next.length > 0 ? next[next.length - 1].id : "manage");
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
          key={activeTheme.id}
          theme={activeTheme}
          onSave={(settings) => {
            persistThemes((prev) => prev.map((t) => (t.id === activeTheme.id ? { ...t, settings } : t)));
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

/** 颜色选择：HSV 调色板（色相条 + 饱和度/亮度平面，可拖动）。色块点击展开。 */
function ColorField({ value, disabled, onChange }: { value: string; disabled: boolean; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const [hsv, setHsv] = useState<Hsv>(() => hexToHsv(value));
  const hsvRef = useRef(hsv);
  const svRef = useRef<HTMLDivElement>(null);
  const hueRef = useRef<HTMLDivElement>(null);
  const commitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    hsvRef.current = hsv;
  }, [hsv]);
  useEffect(() => {
    setHsv(hexToHsv(value));
  }, [value]);

  function clamp(n: number, lo: number, hi: number): number {
    return Math.max(lo, Math.min(hi, n));
  }
  function commit(hex: string, immediate: boolean): void {
    if (commitTimer.current) clearTimeout(commitTimer.current);
    if (immediate) onChange(hex);
    else commitTimer.current = setTimeout(() => onChange(hex), 120);
  }
  function apply(nh: number, ns: number, nv: number, immediate = false): void {
    const next: Hsv = { h: ((nh % 360) + 360) % 360, s: clamp(ns, 0, 100), v: clamp(nv, 0, 100) };
    hsvRef.current = next;
    setHsv(next);
    commit(hsvToHex(next.h, next.s, next.v), immediate);
  }
  function move(ev: MouseEvent, kind: "sv" | "hue"): void {
    if (kind === "hue") {
      const rect = hueRef.current!.getBoundingClientRect();
      apply(((ev.clientX - rect.left) / rect.width) * 360, hsvRef.current.s, hsvRef.current.v);
    } else {
      const rect = svRef.current!.getBoundingClientRect();
      const s = ((ev.clientX - rect.left) / rect.width) * 100;
      const v = 100 - ((ev.clientY - rect.top) / rect.height) * 100;
      apply(hsvRef.current.h, s, v);
    }
  }
  function startDrag(kind: "sv" | "hue", e: React.MouseEvent): void {
    e.preventDefault();
    move(e.nativeEvent, kind);
    const onMove = (ev: MouseEvent) => move(ev, kind);
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      commit(hsvToHex(hsvRef.current.h, hsvRef.current.s, hsvRef.current.v), true);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  const hueCss = hsvToHex(hsv.h, 100, 100);

  return (
    <div className="color-field">
      <button className="color-swatch" style={{ background: value }} disabled={disabled} onClick={() => setOpen((o) => !o)} />
      {open && !disabled && (
        <div className="color-popover">
          <div
            className="sv-plane"
            ref={svRef}
            style={{ background: hueCss }}
            onMouseDown={(e) => startDrag("sv", e)}
          >
            <div className="sv-thumb" style={{ left: `${hsv.s}%`, top: `${100 - hsv.v}%` }} />
          </div>
          <div className="hue-bar" ref={hueRef} onMouseDown={(e) => startDrag("hue", e)}>
            <div className="hue-thumb" style={{ left: `${(hsv.h / 360) * 100}%` }} />
          </div>
          <div className="color-hex">{value}</div>
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
