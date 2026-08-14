import { useMemo, useState } from "react";
import type { MinexKernel } from "@minex/kernel";
import { loadAgentConfig, saveAgentConfig, type AgentConfig } from "./chat-history.js";

/** role 贡献形状（.value 纪律） */
interface RoleLike {
  id: string;
  name: string;
  description?: string;
  systemPrompt: string;
  tools?: string[];
}

/** tool 贡献形状（.value 纪律） */
interface ToolLike {
  name: string;
  description: string;
  risk?: string;
}

/**
 * Agent 配置面板（F-A 反馈 4）：persona 画廊（只读信息 + 工具白名单勾选）+ 默认权限模式 + 默认 systemPrompt。
 * 存内核 storage `minex.agent/agentConfig`（personaTools: Record<personaId, string[] | null>，null = 全部）。
 * 聊天会话模式消费（chat-view）：工具白名单 / canRun 缺省模式 / basePrompt 缺省，无配置回退现状。
 */
export default function AgentConfigView({ kernel }: { kernel: MinexKernel }) {
  const personas = useMemo<RoleLike[]>(
    () => kernel.registry.query<RoleLike>("role").map((c) => c.value),
    [kernel],
  );
  const tools = useMemo<ToolLike[]>(
    () => kernel.registry.query<ToolLike>("tool").map((c) => c.value),
    [kernel],
  );
  const toolNames = useMemo(() => tools.map((t) => t.name), [tools]);

  const [config, setConfig] = useState<AgentConfig>(() => loadAgentConfig(kernel) ?? {});
  // 编辑态：personaId → 勾选工具集合；null = 全部（agentConfig.personaTools 语义）
  const [edits, setEdits] = useState<Record<string, Set<string> | null>>(() => {
    const out: Record<string, Set<string> | null> = {};
    for (const p of personas) {
      const t = config.personaTools?.[p.id];
      out[p.id] = t === undefined ? null : t === null ? null : new Set(t);
    }
    return out;
  });
  const [saved, setSaved] = useState(false);

  /** 切换某 persona 的工具勾选：全部 → 点掉一个 = 转自定义（其余仍勾）；自定义 → 全勾 = 回全部 */
  function toggleTool(personaId: string, name: string): void {
    setEdits((prev) => {
      const cur = prev[personaId];
      const next = new Set(cur ?? toolNames);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return { ...prev, [personaId]: next.size === toolNames.length ? null : next };
    });
  }

  function save(): void {
    const personaTools: Record<string, string[] | null> = {};
    for (const p of personas) {
      const set = edits[p.id];
      personaTools[p.id] = set === null ? null : [...set];
    }
    saveAgentConfig(kernel, {
      personaTools,
      ...(config.defaultPermissionMode ? { defaultPermissionMode: config.defaultPermissionMode } : {}),
      ...(config.defaultSystemPrompt ? { defaultSystemPrompt: config.defaultSystemPrompt } : {}),
    });
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1200);
  }

  return (
    <div className="agent-config">
      <div className="section-title">Persona 画廊</div>
      {personas.length === 0 && <div className="muted">（无 persona）</div>}
      {personas.map((p) => {
        const set = edits[p.id];
        const allChecked = set === null;
        return (
          <div key={p.id} className="agent-config-persona">
            <div className="agent-config-persona-head">
              <strong>{p.name}</strong>
              <span className="muted">{p.id}</span>
              <button
                className="btn-ghost"
                title="设为当前会话 persona（emit minex:setPersona，聊天实例切换）"
                onClick={() => kernel.events.emit("minex:setPersona", { personaId: p.id })}
              >
                设为当前会话
              </button>
            </div>
            <div className="muted agent-config-desc">{p.description ?? ""}</div>
            <details className="agent-config-prompt">
              <summary>systemPrompt</summary>
              <pre>{p.systemPrompt}</pre>
            </details>
            <div className="agent-config-tools">
              <div className="muted">工具白名单（{allChecked ? "全部" : `${set!.size}/${toolNames.length}`}）</div>
              <div className="agent-config-tool-grid">
                {toolNames.map((t) => (
                  <label key={t} className="agent-config-tool">
                    <input
                      type="checkbox"
                      checked={allChecked || set!.has(t)}
                      onChange={() => toggleTool(p.id, t)}
                    />
                    <span>{t}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>
        );
      })}

      <div className="section-title">默认配置（无会话级设置时生效）</div>
      <div className="field">
        <label>默认权限模式</label>
        <div className="field-control">
          <select
            value={config.defaultPermissionMode ?? "auto"}
            onChange={(e) =>
              setConfig((c) => ({
                ...c,
                defaultPermissionMode: e.target.value as "auto" | "edit" | "manual",
              }))
            }
          >
            <option value="auto">自动（完全自由）</option>
            <option value="edit">编辑（写自由，运行需许可）</option>
            <option value="manual">手动（写入和运行需许可）</option>
          </select>
        </div>
      </div>
      <div className="field">
        <label>默认 systemPrompt</label>
        <div className="field-control">
          <textarea
            rows={3}
            value={config.defaultSystemPrompt ?? ""}
            placeholder="留空 = 使用 persona 的默认提示词"
            onChange={(e) => setConfig((c) => ({ ...c, defaultSystemPrompt: e.target.value }))}
          />
        </div>
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8 }}>
        <button className="btn" onClick={save}>
          保存配置
        </button>
        {saved && <span className="muted">已保存</span>}
      </div>
    </div>
  );
}
