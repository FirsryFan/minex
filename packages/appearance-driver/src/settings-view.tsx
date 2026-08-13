import type { MinexKernel } from "@minex/kernel";
import { useEffect, useMemo, useRef, useState } from "react";
import { Plus, X } from "lucide-react";
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
  const themesRef = useRef(themes);
  useEffect(() => {
    themesRef.current = themes;
  }, [themes]);

  // M1：副作用移出 setState updater（用 ref 取最新值，storage 写 + emit 在 updater 外）
  function persistThemes(updater: (prev: Theme[]) => Theme[]): void {
    const next = updater(themesRef.current);
    setThemes(next);
    kernel.storage.namespace("minex.appearance").set(THEMES_KEY, next);
    kernel.events.emit("minex:dataChanged", { driverId: "minex.appearance" });
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
                <X size={12} />
              </span>
            )}
          </span>
        ))}
      </div>

      {activeTab === "about" && <AboutView kernel={kernel} />}
      {activeTab === "manage" && (
        <>
          <ThemeGrid themes={themes} onOpen={openTheme} />
          <GlobalSettingsPanel kernel={kernel} />
        </>
      )}
      {activeTheme && (
        <ThemeSettings
          key={activeTheme.id}
          kernel={kernel}
          theme={activeTheme}
          onSave={(settings) => {
            persistThemes((prev) => prev.map((t) => (t.id === activeTheme.id ? { ...t, settings } : t)));
          }}
        />
      )}
    </div>
  );
}

/** 介绍页：用 markdown 驱动的通用渲染能力（无 markdown 驱动则回退纯文本） */
function AboutView({ kernel }: { kernel: MinexKernel }) {
  const renderer = kernel.registry.get<{ render: (md: string) => string }>("markdown", "render");
  const html = useMemo(() => (renderer ? renderer.value.render(readme) : null), [renderer]);

  if (html) {
    return <div className="card readme-card markdown-body" dangerouslySetInnerHTML={{ __html: html }} />;
  }
  return (
    <div className="card readme-card">
      <pre style={{ whiteSpace: "pre-wrap", fontFamily: "var(--font-content)" }}>{readme}</pre>
    </div>
  );
}

function ThemeGrid({ themes, onOpen }: { themes: Theme[]; onOpen: (t: Theme) => void }) {
  return (
    <div className="theme-grid">
      <div className="theme-card theme-add" title="主题商店">
        <div className="theme-add-plus"><Plus size={18} /></div>
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
  kernel,
  theme,
  onSave,
}: {
  kernel: MinexKernel;
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

      <div className="section-title">CSS 代码</div>
      <div className="field">
        <label>自定义 CSS</label>
        <div className="field-control">
          <textarea
            rows={8}
            disabled={readonly}
            value={String(settings.customCss ?? "")}
            onChange={(e) => setField("customCss", e.target.value)}
          />
        </div>
      </div>

      {/* 驱动设置：其他驱动通过 appearance.driverSetting 注册的外观设置，统一在此管理 */}
      <DriverSettingsSection kernel={kernel} />
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
            style={{ backgroundColor: hueCss }}
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

interface DriverAppearanceItem {
  key: string;
  label: string;
  type: "font" | "color" | "select" | "string";
  enum?: string[];
  default?: string;
}
interface DriverAppearanceSetting {
  driverId: string;
  title: string;
  items: DriverAppearanceItem[];
}

/** 驱动设置区：渲染其他驱动通过 appearance.driverSetting 注册的外观设置 */
function DriverSettingsSection({ kernel }: { kernel: MinexKernel }) {
  // 宿主视图：registry.query 返回 Contribution[]，需 .map(c => c.value)（受限视图 ctx.query 才返回 T[]）
  const settings = kernel.registry
    .query<DriverAppearanceSetting>("appearance.driverSetting")
    .map((c) => c.value);
  if (settings.length === 0) return null;
  return (
    <>
      <div className="section-title">驱动设置</div>
      {settings.map((ds) => (
        <div key={ds.driverId} style={{ marginBottom: 8 }}>
          <div className="muted">{ds.title}</div>
          {ds.items.map((item) => (
            <DriverSettingItem key={item.key} kernel={kernel} driverId={ds.driverId} item={item} />
          ))}
        </div>
      ))}
    </>
  );
}

function DriverSettingItem({
  kernel,
  driverId,
  item,
}: {
  kernel: MinexKernel;
  driverId: string;
  item: DriverAppearanceItem;
}) {
  const ns = kernel.storage.namespace(driverId);
  const [value, setValue] = useState<string>(() => String(ns.get(item.key) ?? item.default ?? ""));

  function set(v: string): void {
    setValue(v);
    ns.set(item.key, v);
    kernel.events.emit("minex:dataChanged", { driverId });
  }

  if (item.type === "font") {
    return <FontRow label={item.label} fonts={item.enum ?? []} value={value} readonly={false} onChange={set} />;
  }
  if (item.type === "select") {
    return (
      <div className="field">
        <label>{item.label}</label>
        <div className="field-control">
          <select value={value} onChange={(e) => set(e.target.value)}>
            {(item.enum ?? []).map((o) => (
              <option key={o} value={o}>{o}</option>
            ))}
          </select>
        </div>
      </div>
    );
  }
  if (item.type === "color") {
    return (
      <div className="field">
        <label>{item.label}</label>
        <div className="field-control">
          <ColorField value={value || "#000000"} disabled={false} onChange={set} />
        </div>
      </div>
    );
  }
  return (
    <div className="field">
      <label>{item.label}</label>
      <div className="field-control">
        <input type="text" value={value} onChange={(e) => set(e.target.value)} />
      </div>
    </div>
  );
}

/** 全局外观设置面板（独立于主题，存储于 "globalSettings"） */
function GlobalSettingsPanel({ kernel }: { kernel: MinexKernel }) {
  const ns = kernel.storage.namespace("minex.appearance");
  const [g, setG] = useState<Record<string, unknown>>(() => (ns.get("globalSettings") as Record<string, unknown>) ?? {});

  function setField(key: string, value: unknown): void {
    const next = { ...g, [key]: value };
    setG(next);
    ns.set("globalSettings", next);
    kernel.events.emit("minex:dataChanged", { driverId: "minex.appearance" });
  }

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div className="section-title">全局设置</div>
      {/* 数字输入：输入过程不立即 clamp（避免逐字符立刻更正），失焦/回车时边界检测并应用 */}
      <NumberField label="全局缩放" value={Number(g.zoom ?? 100)} min={50} max={200} onCommit={(v) => setField("zoom", v)} />
      <div className="field">
        <label>动画效果</label>
        <div className="field-control">
          <input type="checkbox" checked={g.animations !== false} onChange={(e) => setField("animations", e.target.checked)} />
        </div>
      </div>
      <div className="field">
        <label>亚克力效果</label>
        <div className="field-control">
          <input type="checkbox" checked={g.acrylic === true} onChange={(e) => setField("acrylic", e.target.checked)} />
        </div>
      </div>
      <NumberField label="亚克力透明度" value={Number(g.acrylicOpacity ?? 80)} min={0} max={100} onCommit={(v) => setField("acrylicOpacity", v)} />
      <div className="field">
        <label>背景图片 URL</label>
        <div className="field-control">
          <input type="text" value={String(g.backgroundImage ?? "")} onChange={(e) => setField("backgroundImage", e.target.value)} />
        </div>
      </div>
    </div>
  );
}

/** 数字输入框：本地保存输入串，失焦/回车时做边界 clamp 并提交（输入过程不立即更正）。 */
function NumberField({
  label,
  value,
  min,
  max,
  onCommit,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onCommit: (v: number) => void;
}) {
  const [text, setText] = useState(String(value));
  useEffect(() => {
    setText(String(value));
  }, [value]);

  function commit(): void {
    const n = Number(text);
    const v = Number.isNaN(n) ? min : Math.min(max, Math.max(min, n));
    setText(String(v));
    onCommit(v);
  }

  return (
    <div className="field">
      <label>{label}</label>
      <div className="field-control">
        <input
          type="number"
          min={min}
          max={max}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
        />
      </div>
    </div>
  );
}

function clamp(v: number, lo: number, hi: number): number {
  if (Number.isNaN(v)) return lo;
  return Math.max(lo, Math.min(hi, v));
}
