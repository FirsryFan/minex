import { Suspense, lazy, useState } from "react";
import type { ComponentType } from "react";
import type { MinexKernel } from "@minex/kernel";
import { DriverIcon } from "./DriverIcon.js";
import { SettingsForm } from "./SettingsForm.js";

type Tab = "about" | "settings";

interface SettingsViewContribution {
  load: () => Promise<{ default: ComponentType<{ kernel: MinexKernel }> }>;
}

/**
 * 驱动详情页：头部（大图标居左 + 介绍居右）+ 选项卡（介绍 / 设置）。
 * 若驱动贡献了 settingsView（自定义设置界面），则用其替代默认「介绍/设置」结构。
 * 图片大小恒定（足够大的值），不随介绍内容宽度变化。
 */
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
  const state = kernel.drivers.getState(m.id);

  // 方案 A：驱动贡献的自定义设置视图（惰性加载），替代默认结构
  const settingsView = kernel.registry.get<SettingsViewContribution>("settingsView", driverId);
  if (settingsView) {
    const View = lazy(settingsView.value.load);
    return (
      <div>
        <div className="manage-toolbar">
          <button className="icon-btn" onClick={onBack}>
            ← 返回
          </button>
        </div>
        <Suspense fallback={<div className="muted">加载设置界面…</div>}>
          <View kernel={kernel} />
        </Suspense>
      </div>
    );
  }

  return (
    <div>
      <div className="manage-toolbar">
        <button className="icon-btn" onClick={onBack}>
          ← 返回
        </button>
      </div>

      {/* 头部：固定大图 + 右侧介绍 */}
      <div className="driver-header">
        <div className="driver-header-icon">
          <DriverIcon icon={m.icon} size={72} />
        </div>
        <div className="driver-header-info">
          <div className="driver-header-name">
            {m.name}
            <span className="muted"> v{m.version}</span>
          </div>
          <div className="driver-header-meta">
            <span>来源：{m.source ?? "本地"}</span>
            <span>最小内核：{m.minKernelVersion ?? "-"}</span>
            <span>状态：{state}</span>
          </div>
          <div className="driver-header-desc">{m.description ?? "（无简介）"}</div>
        </div>
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
          {m.dependencies && m.dependencies.length > 0 && (
            <p>
              <span className="muted">依赖：</span>
              {m.dependencies.join(", ")}
            </p>
          )}
          <p>
            <span className="muted">可热重载：</span>
            {m.reloadable === false ? "否" : "是"}
          </p>
        </div>
      ) : (
        <SettingsForm kernel={kernel} driverId={m.id} schema={m.settingsSchema} />
      )}
    </div>
  );
}
