import { useState } from "react";
import { useKernel } from "../kernel-context.js";

interface SchemaProp {
  type?: string;
  default?: unknown;
  description?: string;
}
interface SettingsSchema {
  type?: string;
  properties?: Record<string, SchemaProp>;
}

/** 通用 JSON Schema 表单（v1：string / number / boolean / 单层 object） */
export function SettingsForm() {
  const kernel = useKernel();
  const driver = kernel.drivers.list().find((p) => p.manifest.settingsSchema);
  const schema = (driver?.manifest.settingsSchema ?? {}) as unknown as SettingsSchema;
  const props = schema.properties ?? {};

  const [values, setValues] = useState<Record<string, unknown>>(() => {
    // U3：driver 可能为 undefined，用可选链，先构造空表再守卫
    const current = driver
      ? kernel.storage.namespace(driver.manifest.id).get<Record<string, unknown>>("config")
      : undefined;
    const initial: Record<string, unknown> = {};
    for (const [k, p] of Object.entries(props)) {
      initial[k] = current?.[k] ?? p.default ?? (p.type === "boolean" ? false : "");
    }
    return initial;
  });

  if (!driver || Object.keys(props).length === 0) {
    return <div className="muted">当前没有可配置的驱动。</div>;
  }

  function setField(key: string, value: unknown): void {
    setValues((v) => ({ ...v, [key]: value }));
  }

  function save(): void {
    kernel.storage.namespace(driver!.manifest.id).set("config", values);
    kernel.events.emit("minex:dataChanged", { driverId: driver!.manifest.id });
  }

  return (
    <div>
      <div className="muted" style={{ marginBottom: 12 }}>
        驱动：{driver.manifest.id}
      </div>
      {Object.entries(props).map(([key, p]) => (
        <div className="field" key={key}>
          <label>{key}</label>
          {p.type === "boolean" ? (
            <input
              type="checkbox"
              checked={Boolean(values[key])}
              onChange={(e) => setField(key, e.target.checked)}
            />
          ) : (
            <input
              type={p.type === "number" ? "number" : "text"}
              value={String(values[key] ?? "")}
              onChange={(e) =>
                setField(
                  key,
                  // U8：number 空输入不覆盖为 0，保留原值
                  p.type === "number" ? (e.target.value === "" ? values[key] : Number(e.target.value)) : e.target.value,
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
