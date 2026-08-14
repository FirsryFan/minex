import { useEffect, useMemo, useState } from "react";
import type { MinexKernel } from "@minex/kernel";
import { deleteAgentProfile, loadAgentProfiles, saveAgentProfile, type AgentProfile } from "./agent-profile.js";

/**
 * Agent 列表面板（P0-3 反馈 3）：左栏「Agents」icon（agent 驱动显示）——profile 列表
 * avatar+name+model + 新建/删除（确认）+ 选中高亮；点击 → emit `minex:selectAgentProfile { id }`
 * （主区配置中心监听切换表单）。新建/删除/主区保存经 minex:dataChanged 联动刷新列表。
 */
export default function AgentListView({ kernel }: { kernel: MinexKernel }) {
  const [profiles, setProfiles] = useState<Record<string, AgentProfile>>(() => loadAgentProfiles(kernel));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const list = useMemo(() => Object.values(profiles), [profiles]);

  // 主区表单保存/删除后刷新列表（minex:dataChanged）
  useEffect(() => {
    return kernel.events.on("minex:dataChanged", () => setProfiles(loadAgentProfiles(kernel)));
  }, [kernel]);

  function select(id: string): void {
    setSelectedId(id);
    kernel.events.emit("minex:selectAgentProfile", { id });
  }

  function createNew(): void {
    const id = `agent.${Date.now()}`;
    saveAgentProfile(kernel, { id, name: "新 agent" });
    setProfiles(loadAgentProfiles(kernel));
    kernel.events.emit("minex:dataChanged", { driverId: "minex.agent" });
    select(id);
  }

  function doDelete(id: string): void {
    deleteAgentProfile(kernel, id);
    setProfiles(loadAgentProfiles(kernel));
    setConfirmDelete(null);
    kernel.events.emit("minex:dataChanged", { driverId: "minex.agent" });
    if (selectedId === id) {
      setSelectedId(null);
      kernel.events.emit("minex:selectAgentProfile", { id: "" }); // 主区表单清空
    }
  }

  return (
    <div className="agent-list">
      <div className="agent-list-head">
        <span className="muted">Agents</span>
        <button className="btn-ghost" title="新建 agent" onClick={createNew}>＋</button>
      </div>
      {list.length === 0 && <div className="muted">无 agent，点 ＋ 新建</div>}
      {list.map((p) => (
        <div
          key={p.id}
          className={`agent-config-item${p.id === selectedId ? " active" : ""}`}
          onClick={() => select(p.id)}
          title={p.description}
        >
          <span className="agent-config-avatar">{p.avatar ?? p.name.slice(0, 1)}</span>
          <span className="agent-config-item-name">{p.name}</span>
          <span className="muted agent-config-item-model">{p.model ?? "默认"}</span>
          <button
            className="agent-list-del"
            title="删除 agent"
            onClick={(e) => {
              e.stopPropagation();
              setConfirmDelete(p.id);
            }}
          >
            ×
          </button>
        </div>
      ))}

      {/* 删除确认 */}
      {confirmDelete && (
        <div className="floating-mask" onClick={() => setConfirmDelete(null)}>
          <div className="confirm-box" onClick={(e) => e.stopPropagation()}>
            <p>确定删除 agent「{profiles[confirmDelete]?.name ?? ""}」？此操作不可撤销。</p>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 12 }}>
              <button className="btn-ghost" onClick={() => setConfirmDelete(null)}>取消</button>
              <button className="btn" onClick={() => doDelete(confirmDelete)}>删除</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
