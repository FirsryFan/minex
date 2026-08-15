import { useEffect, useRef, useState } from "react";
import type { MinexKernel } from "@minex/kernel";

type FieldType = "string" | "number" | "boolean" | "color" | "textarea" | "font";
interface SchemaProp {
  type?: FieldType;
  /** 有 enum 时渲染「带搜索的下拉」 */
  enum?: string[];
  default?: unknown;
  description?: string;
}
interface SettingsGroup {
  title: string;
  properties: Record<string, SchemaProp>;
}
interface SettingsSchema {
  groups?: SettingsGroup[];
  properties?: Record<string, SchemaProp>;
}

/** 驼峰转空格显示：primaryColor → "primary color" */
export function humanize(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .toLowerCase();
}

/**
 * 通用 JSON Schema 表单 v2：
 * - 分组（schema.groups）渲染为多张卡片；
 * - 字段类型：string/number/boolean/color/textarea；有 enum 时渲染带搜索的下拉；
 * - **自动保存**：每次修改即写入 storage config + 发 minex:dataChanged（切走再切回不丢）。
 */
export function SettingsForm({
  kernel,
  driverId,
  schema,
}: {
  kernel: MinexKernel;
  driverId: string;
  schema?: Record<string, unknown>;
}) {
  const raw = (schema ?? {}) as SettingsSchema;
  const groups: SettingsGroup[] =
    raw.groups && raw.groups.length > 0
      ? raw.groups
      : [{ title: "设置", properties: raw.properties ?? {} }];

  const allProps = Object.fromEntries(groups.flatMap((g) => Object.entries(g.properties)));

  const [values, setValues] = useState<Record<string, unknown>>(() => {
    const current = kernel.storage.namespace(driverId).get<Record<string, unknown>>("config");
    const initial: Record<string, unknown> = {};
    for (const [k, p] of Object.entries(allProps)) {
      initial[k] = current?.[k] ?? p.default ?? (p.type === "boolean" ? false : "");
    }
    return initial;
  });

  if (Object.keys(allProps).length === 0) {
    return <div className="muted">该驱动无设置项。</div>;
  }

  // W7：自动保存 debounce（textarea 频繁输入不逐键全链路重写）
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
  }, []);

  // 自动保存：写 storage（基于最新 config 合并）+ 通知（驱动重注册 / ThemeManager 重应用）
  function setField(key: string, value: unknown): void {
    const current = kernel.storage.namespace(driverId).get<Record<string, unknown>>("config") ?? {};
    const next = { ...current, [key]: value };
    setValues((prev) => ({ ...prev, [key]: value })); // UI 立即更新
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      kernel.storage.namespace(driverId).set("config", next);
      kernel.events.emit("minex:dataChanged", { driverId });
    }, 300);
  }

  return (
    <div>
      {groups.map((g) => (
        <div className="card" key={g.title} style={{ marginBottom: 12 }}>
          <div className="section-title">{g.title}</div>
          {Object.entries(g.properties).map(([key, p]) => (
            <div className="field" key={key}>
              {/* P3-B：boolean 由 Field 渲染完整 toggle-item（名+描述+pill），外层不再重复 label/hint */}
              {p.type !== "boolean" && <label title={key}>{humanize(key)}</label>}
              <div className="field-control">
                <Field label={humanize(key)} prop={p} value={values[key]} onChange={(v) => setField(key, v)} />
                {p.type !== "boolean" && p.description && <div className="hint">{p.description}</div>}
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function Field({
  label,
  prop,
  value,
  onChange,
}: {
  label: string;
  prop: SchemaProp;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const t = prop.type ?? "string";
  if (t === "boolean") {
    const on = Boolean(value);
    return (
      <div className={`toggle-item${on ? " on" : ""}`} role="button" onClick={() => onChange(!on)}>
        <div className="toggle-item-main">
          <div className="toggle-item-name">{label}</div>
          {prop.description && <div className="toggle-item-desc">{prop.description}</div>}
        </div>
        <button className={`toggle${on ? " on" : ""}`} aria-label={label} />
      </div>
    );
  }
  if (t === "color") {
    return (
      <input
        type="color"
        value={String(value ?? "#000000")}
        onChange={(e) => {
          // W8：只接受合法十六进制色（#RGB/#RRGGBB），非法输入忽略
          if (/^#[0-9a-fA-F]{3,8}$/.test(e.target.value)) onChange(e.target.value);
        }}
      />
    );
  }
  if (t === "textarea") {
    return <textarea rows={6} value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} />;
  }
  if (t === "font") {
    return <Select value={String(value ?? "")} options={prop.enum ?? []} onChange={onChange} preview />;
  }
  if (prop.enum && prop.enum.length > 0) {
    return <Select value={String(value ?? "")} options={prop.enum} onChange={onChange} />;
  }
  if (t === "number") {
    return (
      <input
        type="number"
        value={String(value ?? "")}
        onChange={(e) => onChange(e.target.value === "" ? value : Number(e.target.value))}
      />
    );
  }
  return <input type="text" value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} />;
}

/** 带搜索的下拉（字体/图标体系等）。W6：点外部/Esc 关闭；preview 时选项用自身字体渲染 */
function Select({
  value,
  options,
  onChange,
  preview = false,
}: {
  value: string;
  options: string[];
  onChange: (v: unknown) => void;
  preview?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const q = query.trim().toLowerCase();
  const filtered = q ? options.filter((o) => o.toLowerCase().includes(q)) : options;

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

  return (
    <div className="driver-selector" ref={ref}>
      <button className="select-btn" onClick={() => setOpen((o) => !o)}>
        {value}
      </button>
      {open && (
        <div className="dropdown">
          <input
            className="dropdown-search"
            placeholder="搜索…"
            value={query}
            autoFocus
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className="dropdown-list">
            {filtered.length === 0 && <div className="muted" style={{ padding: 8 }}>（无匹配）</div>}
            {filtered.map((o) => (
              <div
                key={o}
                className="dropdown-item"
                onClick={() => {
                  onChange(o);
                  setOpen(false);
                  setQuery("");
                }}
              >
                {/* 修复4：字体预览——选项用自身字体渲染 */}
                <span style={preview ? { fontFamily: `"${o}"` } : undefined}>{o}</span>
                {preview && <span style={{ fontFamily: `"${o}"`, color: "var(--color-text-muted)" }}>Preview 字体预览</span>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
