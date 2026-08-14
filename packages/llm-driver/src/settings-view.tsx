import { useState } from "react";
import type { MinexKernel } from "@minex/kernel";

/** llm.config 能力子集（宿主视图取能力值要 .value——漏 .value 是历史高频坑） */
interface LLMConfigCap {
  getApiKey(): string;
  setApiKey(key: string): void;
  getModel(): string;
  setModel(model: string): void;
}

const DEFAULT_MODEL = "deepseek-chat";

/**
 * LLM 配置界面（task 1-2）：API key + 模型名，保存写内核 storage（经 llm.config 能力）。
 * 由设置页 DriverDetail 经 settingsView 贡献惰性加载；provider 动态读 key，保存后立即生效。
 * key 输入为空时保存不改写已有 key（「重新输入以更换」语义，避免误清）。
 */
export default function SettingsView({ kernel }: { kernel: MinexKernel }) {
  // 宿主视图：registry.get 返回 Contribution，能力值在 .value
  const config = kernel.registry.get<LLMConfigCap>("llm.config", "default")?.value;
  const [key, setKey] = useState("");
  const [model, setModel] = useState<string>(() => config?.getModel() || DEFAULT_MODEL);
  const [saved, setSaved] = useState(false);

  const hasKey = Boolean(config?.getApiKey());

  function save(): void {
    if (key) config?.setApiKey(key);
    if (model) config?.setModel(model);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <div className="card">
      <div className="section-title">LLM 配置</div>
      <div className="field">
        <label>API key</label>
        <div className="field-control">
          <input
            type="password"
            value={key}
            placeholder={hasKey ? "已配置（重新输入以更换）" : "未配置"}
            onChange={(e) => setKey(e.target.value)}
          />
        </div>
      </div>
      <div className="field">
        <label>模型名</label>
        <div className="field-control">
          <input value={model} onChange={(e) => setModel(e.target.value)} />
        </div>
      </div>
      <div className="field">
        <div className="field-control">
          <button className="btn" onClick={save}>
            保存
          </button>
          {saved && (
            <span className="muted" style={{ marginLeft: 8 }}>
              已保存
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
