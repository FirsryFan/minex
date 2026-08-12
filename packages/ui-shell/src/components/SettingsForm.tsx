import { useState } from "react";
import type { MinexKernel } from "@minex/kernel";

type FieldType = "string" | "number" | "boolean" | "color" | "textarea";
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

  // 自动保存：写 storage（基于最新 config 合并）+ 通知（驱动重注册 / ThemeManager 重应用）
  function setField(key: string, value: unknown): void {
    const current = kernel.storage.namespace(driverId).get<Record<string, unknown>>("config") ?? {};
    const next = { ...current, [key]: value };
    kernel.storage.namespace(driverId).set("config", next);
    kernel.events.emit("minex:dataChanged", { driverId });
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  return (
    <div>
      {groups.map((g) => (
        <div className="card" key={g.title} style={{ marginBottom: 12 }}>
          <div className="section-title">{g.title}</div>
          {Object.entries(g.properties).map(([key, p]) => (
            <div className="field" key={key}>
              <label>{key}</label>
              <Field prop={p} value={values[key]} onChange={(v) => setField(key, v)} />
              {p.description && <div className="hint">{p.description}</div>}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function Field({
  prop,
  value,
  onChange,
}: {
  prop: SchemaProp;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const t = prop.type ?? "string";
  if (t === "boolean") {
    return <input type="checkbox" checked={Boolean(value)} onChange={(e) => onChange(e.target.checked)} />;
  }
  if (t === "color") {
    return <input type="color" value={String(value ?? "#000000")} onChange={(e) => onChange(e.target.value)} />;
  }
  if (t === "textarea") {
    return <textarea rows={6} value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} />;
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

/** 带搜索的下拉（字体/图标体系等） */
function Select({
  value,
  options,
  onChange,
}: {
  value: string;
  options: string[];
  onChange: (v: unknown) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const filtered = q ? options.filter((o) => o.toLowerCase().includes(q)) : options;

  return (
    <div className="driver-selector">
      <button className="select-btn" onClick={() => setOpen((o) => !o)}>
        {value || "（默认）"}
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
                {o}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
