import { useState } from "react";
import type { MinexKernel } from "@minex/kernel";
import { DriverIcon } from "./DriverIcon.js";
import { SettingsForm } from "./SettingsForm.js";

type Tab = "about" | "settings";

/** 驱动详情页：信息 + 选项卡（介绍 / 设置）。返回按钮在左上角。 */
export function DriverDetail({
  kernel,
  driverId,
  onBack,
}: {
  kernel: MinexKernel;
  driverId: string;
  onBack: () => void;
}) {
  const [tab, setTab] = useState<Tab>("about");
  const driver = kernel.drivers.list().find((d) => d.manifest.id === driverId);

  if (!driver) {
    return <div className="card muted">驱动不存在：{driverId}</div>;
  }
  const m = driver.manifest;

  return (
    <div>
      <div className="manage-toolbar">
        <button className="icon-btn" onClick={onBack}>
          ← 返回
        </button>
        <DriverIcon icon={m.icon} size={24} />
        <strong>{m.name}</strong>
        <span className="muted">v{m.version}</span>
      </div>

      <div className="detail-tabs">
        <button className={`detail-tab${tab === "about" ? " active" : ""}`} onClick={() => setTab("about")}>
          介绍
        </button>
        <button className={`detail-tab${tab === "settings" ? " active" : ""}`} onClick={() => setTab("settings")}>
          设置
        </button>
      </div>

      {tab === "about" ? (
        <div className="card">
          <p>
            <span className="muted">id：</span>
            {m.id}
          </p>
          <p>
            <span className="muted">版本：</span>
            {m.version}
          </p>
          {m.dependencies && m.dependencies.length > 0 && (
            <p>
              <span className="muted">依赖：</span>
              {m.dependencies.join(", ")}
            </p>
          )}
          <p>
            <span className="muted">状态：</span>
            {kernel.drivers.getState(m.id)}
          </p>
        </div>
      ) : (
        <SettingsForm kernel={kernel} driverId={m.id} schema={m.settingsSchema} />
      )}
    </div>
  );
}
