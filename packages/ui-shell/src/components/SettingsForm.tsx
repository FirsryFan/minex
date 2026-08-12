import { useState } from "react";
import type { MinexKernel } from "@minex/kernel";

interface SchemaProp {
  type?: string;
  default?: unknown;
  description?: string;
}
interface SettingsSchema {
  type?: string;
  properties?: Record<string, SchemaProp>;
}

/**
 * 通用 JSON Schema 表单（string / number / boolean，单层 object）。
 * 值存 storage.namespace(driverId).get/set("config")（与 CLI 同 key）。
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
  const props = ((schema ?? {}) as SettingsSchema).properties ?? {};

  const [values, setValues] = useState<Record<string, unknown>>(() => {
    const current = kernel.storage.namespace(driverId).get<Record<string, unknown>>("config");
    const initial: Record<string, unknown> = {};
    for (const [k, p] of Object.entries(props)) {
      initial[k] = current?.[k] ?? p.default ?? (p.type === "boolean" ? false : "");
    }
    return initial;
  });

  if (Object.keys(props).length === 0) {
    return <div className="muted">该驱动无设置项。</div>;
  }

  function setField(key: string, value: unknown): void {
    setValues((v) => ({ ...v, [key]: value }));
  }

  function save(): void {
    kernel.storage.namespace(driverId).set("config", values);
    kernel.events.emit("minex:dataChanged", { driverId });
  }

  return (
    <div className="card">
      {Object.entries(props).map(([key, p]) => (
        <div className="field" key={key}>
          <label>{key}</label>
          {p.type === "boolean" ? (
            <input type="checkbox" checked={Boolean(values[key])} onChange={(e) => setField(key, e.target.checked)} />
          ) : (
            <input
              type={p.type === "number" ? "number" : "text"}
              value={String(values[key] ?? "")}
              onChange={(e) =>
                setField(
                  key,
                  p.type === "number"
                    ? e.target.value === ""
                      ? values[key]
                      : Number(e.target.value)
                    : e.target.value,
                )
              }
            />
          )}
          {p.description && <div className="hint">{p.description}</div>}
        </div>
      ))}
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button className="btn" onClick={save}>
          保存
        </button>
      </div>
    </div>
  );
}
