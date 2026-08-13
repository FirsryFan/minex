import type { MinexKernel } from "@minex/kernel";
import { useState } from "react";
// Vite raw import：README.md 作为介绍页显示
import readme from "../README.md?raw";

/** 主题模型 */
interface Theme {
  id: string;
  name: string;
  version: string;
  author: string;
  /** 预览图 URL（v1 可空，显示占位） */
  preview?: string;
  /** 下载主题不可修改 */
  readOnly?: boolean;
  settings?: Record<string, unknown>;
}

/** 全局设置字段 */
const GLOBAL_COLORS = [
  { key: "primaryColor", label: "主题色" },
  { key: "backgroundColor", label: "背景色" },
  { key: "warningColor", label: "提示色" },
  { key: "dangerColor", label: "警告色" },
];
const EN_FONTS = ["Arial", "Georgia", "Times New Roman", "Verdana", "Tahoma", "Trebuchet MS", "Segoe UI", "Roboto", "Open Sans", "Courier New", "Consolas", "Impact", "Comic Sans MS"];
const ZH_FONTS = ["PingFang SC", "Microsoft YaHei", "SimHei", "SimSun", "Songti SC", "KaiTi", "FangSong", "Noto Sans CJK SC", "Source Han Sans SC"];
const ICON_THEMES = ["默认", "简约"];

const DEFAULT_THEME: Theme = {
  id: "default",
  name: "默认主题",
  version: "1.0.0",
  author: "Minex",
  settings: {
    primaryColor: "#2563eb",
    backgroundColor: "#f3f6fb",
    warningColor: "#f59e0b",
    dangerColor: "#ef4444",
    zhFont: "Microsoft YaHei",
    enFont: "Arial",
    iconTheme: "默认",
  },
};

const THEMES_KEY = "themes";

/** appearance 驱动的设置视图：介绍(README) / 管理主题 / 双击打开主题选项卡 */
export default function SettingsView({ kernel }: { kernel: MinexKernel }) {
  const [tab, setTab] = useState<"about" | "manage">("about");
  const [openThemeIds, setOpenThemeIds] = useState<string[]>([]);
  const [themes, setThemes] = useState<Theme[]>(() => loadThemes(kernel));

  function loadThemes(k: MinexKernel): Theme[] {
    const saved = k.storage.namespace("minex.appearance").get<Theme[]>(THEMES_KEY);
    return saved && saved.length > 0 ? saved : [DEFAULT_THEME];
  }

  function persistThemes(next: Theme[]): void {
    kernel.storage.namespace("minex.appearance").set(THEMES_KEY, next);
    setThemes(next);
    kernel.events.emit("minex:dataChanged", { driverId: "minex.appearance" });
  }

  function openTheme(id: string): void {
    setOpenThemeIds((ids) => (ids.includes(id) ? ids : [...ids, id]));
    setTab("manage");
  }
  function closeTheme(id: string): void {
    setOpenThemeIds((ids) => ids.filter((x) => x !== id));
  }

  return (
    <div>
      {/* 主选项卡：介绍 / 管理主题 */}
      <div className="detail-tabs">
        <button className={`detail-tab${tab === "about" ? " active" : ""}`} onClick={() => setTab("about")}>
          介绍
        </button>
        <button className={`detail-tab${tab === "manage" ? " active" : ""}`} onClick={() => setTab("manage")}>
          管理主题
        </button>
      </div>

      {tab === "about" ? (
        <div className="card readme-card">
          <pre style={{ whiteSpace: "pre-wrap", fontFamily: "var(--font-content)" }}>{readme}</pre>
        </div>
      ) : (
        <ThemeGrid themes={themes} onOpen={openTheme} />
      )}

      {/* 双击打开的主题选项卡（右侧可关闭） */}
      {openThemeIds.map((id) => {
        const theme = themes.find((t) => t.id === id);
        if (!theme) return null;
        return (
          <div className="theme-open-panel" key={id}>
            <div className="theme-open-head">
              <strong>{theme.name}</strong>
              <button className="icon-btn" onClick={() => closeTheme(id)}>
                ×
              </button>
            </div>
            <ThemeSettings
              kernel={kernel}
              theme={theme}
              onSave={(settings) => {
                persistThemes(themes.map((t) => (t.id === id ? { ...t, settings } : t)));
              }}
            />
          </div>
        );
      })}
    </div>
  );
}

/** 主题卡片网格 + 虚线框加号（市场占位） */
function ThemeGrid({ themes, onOpen }: { themes: Theme[]; onOpen: (id: string) => void }) {
  return (
    <div className="theme-grid">
      {/* 虚线框加号 → 主题商店（占位） */}
      <div className="theme-card theme-add" title="主题商店（后续）">
        <div className="theme-add-plus">＋</div>
        <div className="muted">前往主题商店</div>
      </div>
      {themes.map((t) => (
        <div key={t.id} className="theme-card" onDoubleClick={() => onOpen(t.id)} title="双击打开主题设置">
          <div className="theme-preview">
            {t.preview ? <img src={t.preview} alt={t.name} /> : <div className="theme-preview-placeholder">{t.name}</div>}
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

/** 主题全局设置表单（颜色/字体/图标），自动保存语义（手动重载由外层驱动决定） */
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
            <input
              type="color"
              value={String(settings[c.key] ?? "#000000")}
              disabled={readonly}
              onChange={(e) => {
                if (/^#[0-9a-fA-F]{3,8}$/.test(e.target.value)) setField(c.key, e.target.value);
              }}
            />
          </div>
        </div>
      ))}

      <div className="section-title" style={{ marginTop: 12 }}>字体设置</div>
      <FontRow label="全局中文" fonts={ZH_FONTS} value={String(settings.zhFont ?? "")} readonly={readonly} onChange={(v) => setField("zhFont", v)} />
      <FontRow label="全局英文" fonts={EN_FONTS} value={String(settings.enFont ?? "")} readonly={readonly} onChange={(v) => setField("enFont", v)} />

      <div className="section-title" style={{ marginTop: 12 }}>图标设置</div>
      <div className="field">
        <label>图标体系</label>
        <div className="field-control">
          <select
            value={String(settings.iconTheme ?? "默认")}
            disabled={readonly}
            onChange={(e) => setField("iconTheme", e.target.value)}
          >
            {ICON_THEMES.map((o) => (
              <option key={o} value={o}>{o}</option>
            ))}
          </select>
        </div>
      </div>

      {readonly && <div className="hint">下载主题不可修改；修改需先复制为新主题</div>}
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
            <span style={{ fontFamily: value ? `"${value}"` : undefined }}>{value || "（默认）"}</span>
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
                    <span className="muted" style={{ fontFamily: `"${f}"` }}>预览 Preview</span>
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
