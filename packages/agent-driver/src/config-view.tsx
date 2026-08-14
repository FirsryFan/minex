import { useMemo, useState } from "react";
import type { MinexKernel } from "@minex/kernel";
import {
  BUILTIN_SKILLS,
  deleteAgentProfile,
  loadAgentProfiles,
  saveAgentProfile,
  type AgentProfile,
} from "./agent-profile.js";

/** role 贡献形状（.value 纪律） */
interface RoleLike {
  id: string;
  name: string;
  description?: string;
  systemPrompt: string;
}

/** tool 贡献形状（.value 纪律） */
interface ToolLike {
  name: string;
  description: string;
  risk?: string;
}

/**
 * Agent 配置中心（F-D 反馈 3）：两栏——左列 profile 列表（avatar+name+model）+ 右列全字段表单。
 * 存内核 storage `minex.agent/agentProfiles`（Record<id, AgentProfile>）。
 * 代码插槽：filePool 路径点击 → filesystem 读 → markdown 渲染代码块预览 → 「保存到插槽」写 slots.code
 * （slots.code v1 仅管理/预览，不注入 agent——执行留阶段 4+）。
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
  const fs = kernel.registry.get<{ readFile(path: string): Promise<string> }>("filesystem", "default")?.value;
  const md = kernel.registry.get<{ render(src: string): string }>("markdown", "render")?.value;

  const [profiles, setProfiles] = useState<Record<string, AgentProfile>>(() => loadAgentProfiles(kernel));
  const [selectedId, setSelectedId] = useState<string | null>(() => {
    const all = loadAgentProfiles(kernel);
    return Object.keys(all)[0] ?? null;
  });
  const [draft, setDraft] = useState<AgentProfile | null>(() => {
    const all = loadAgentProfiles(kernel);
    const first = Object.keys(all)[0];
    return first ? all[first] : null;
  });
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [savedTick, setSavedTick] = useState(false);
  const [poolInput, setPoolInput] = useState("");
  // 代码插槽预览（F-D）：filePool 路径 → 文件原始内容
  const [preview, setPreview] = useState<{ path: string; raw: string } | null>(null);

  const profileList = Object.values(profiles);
  const selected = draft ?? null;

  function patch(p: Partial<AgentProfile>): void {
    setDraft((d) => (d ? { ...d, ...p } : d));
  }

  function selectProfile(id: string): void {
    setSelectedId(id);
    setDraft(profiles[id] ?? null);
    setPreview(null);
  }

  function createNew(): void {
    const id = `agent.${Date.now()}`;
    const p: AgentProfile = { id, name: "新 agent" };
    saveAgentProfile(kernel, p);
    setProfiles(loadAgentProfiles(kernel));
    setSelectedId(id);
    setDraft(p);
    setPreview(null);
  }

  function confirmDeleteProfile(): void {
    if (!selectedId) return;
    deleteAgentProfile(kernel, selectedId);
    const all = loadAgentProfiles(kernel);
    setProfiles(all);
    const first = Object.keys(all)[0];
    setSelectedId(first ?? null);
    setDraft(first ? all[first] : null);
    setPreview(null);
    setConfirmDelete(false);
  }

  function save(): void {
    if (!selected) return;
    saveAgentProfile(kernel, selected);
    setProfiles(loadAgentProfiles(kernel));
    setSavedTick(true);
    window.setTimeout(() => setSavedTick(false), 1200);
  }

  /** 工具白名单切换（F-D：null=全部；点掉一个转自定义；全勾回 null） */
  function toggleTool(name: string): void {
    const cur = selected?.tools;
    const next = new Set(cur ?? toolNames);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    patch({ tools: next.size === toolNames.length ? null : [...next] });
  }

  /** skill 勾选切换 */
  function toggleSkill(id: string): void {
    const cur = new Set(selected?.skills ?? []);
    if (cur.has(id)) cur.delete(id);
    else cur.add(id);
    patch({ skills: [...cur] });
  }

  /** filePool 添加/删除路径 */
  function addPoolPath(): void {
    const t = poolInput.trim();
    if (!t) return;
    patch({ filePool: [...(selected?.filePool ?? []), t] });
    setPoolInput("");
  }
  function removePoolPath(p: string): void {
    patch({ filePool: (selected?.filePool ?? []).filter((x) => x !== p) });
  }

  /** 代码插槽预览：读文件 → markdown 渲染代码块 */
  async function previewFile(path: string): Promise<void> {
    if (!fs) {
      setPreview({ path, raw: "（尚未打开文件夹或文件系统不可用）" });
      return;
    }
    try {
      const raw = await fs.readFile(path);
      setPreview({ path, raw });
    } catch (err) {
      setPreview({ path, raw: `读取失败：${err instanceof Error ? err.message : String(err)}` });
    }
  }

  /** 保存到插槽：写 slots.code（v1 仅管理/预览，不注入 agent） */
  function saveToSlot(): void {
    if (!preview) return;
    patch({ slots: { ...(selected?.slots ?? {}), code: preview.raw } });
  }

  const avatarText = selected?.avatar ?? (selected?.name ? selected.name.slice(0, 1) : "?");

  return (
    <div className="agent-config-center">
      {/* 左列：profile 列表 */}
      <div className="agent-config-side">
        <div className="agent-config-side-head">
          <span className="muted">Agents</span>
          <button className="btn-ghost" title="新建 agent" onClick={createNew}>＋</button>
        </div>
        {profileList.length === 0 && <div className="muted">（无 agent，点 ＋ 新建）</div>}
        {profileList.map((p) => (
          <div
            key={p.id}
            className={`agent-config-item${p.id === selectedId ? " active" : ""}`}
            onClick={() => selectProfile(p.id)}
          >
            <span className="agent-config-avatar">{p.avatar ?? p.name.slice(0, 1)}</span>
            <span className="agent-config-item-name">{p.name}</span>
            <span className="muted agent-config-item-model">{p.model ?? "默认"}</span>
          </div>
        ))}
        {selectedId && (
          <button className="btn-ghost agent-config-delete" onClick={() => setConfirmDelete(true)}>
            删除当前 agent
          </button>
        )}
      </div>

      {/* 右列：全字段表单 */}
      <div className="agent-config-form">
        {!selected ? (
          <div className="muted">（选择或新建一个 agent）</div>
        ) : (
          <>
            <div className="agent-config-form-head">
              <strong>{selected.name}</strong>
              <span className="muted">{selected.id}</span>
              <button className="btn" onClick={save}>保存</button>
              {savedTick && <span className="muted">已保存</span>}
            </div>
            <div className="agent-config-grid">
              <div className="field">
                <label>名字</label>
                <div className="field-control">
                  <input value={selected.name} onChange={(e) => patch({ name: e.target.value })} />
                </div>
              </div>
              <div className="field">
                <label>头像（emoji/首字）</label>
                <div className="field-control">
                  <input
                    value={selected.avatar ?? ""}
                    placeholder={`留空 = 首字（${avatarText}）`}
                    onChange={(e) => patch({ avatar: e.target.value || undefined })}
                  />
                </div>
              </div>
              <div className="field">
                <label>描述</label>
                <div className="field-control">
                  <input
                    value={selected.description ?? ""}
                    onChange={(e) => patch({ description: e.target.value || undefined })}
                  />
                </div>
              </div>
              <div className="field">
                <label>persona</label>
                <div className="field-control">
                  <select
                    value={selected.personaId ?? ""}
                    onChange={(e) => patch({ personaId: e.target.value || undefined })}
                  >
                    <option value="">（不指定）</option>
                    {personas.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="field">
                <label>systemPrompt（覆盖 persona）</label>
                <div className="field-control">
                  <textarea
                    rows={3}
                    value={selected.systemPrompt ?? ""}
                    placeholder="留空 = 使用 persona 的默认提示词"
                    onChange={(e) => patch({ systemPrompt: e.target.value || undefined })}
                  />
                </div>
              </div>
              <div className="field">
                <label>模型</label>
                <div className="field-control">
                  <input
                    value={selected.model ?? ""}
                    placeholder="留空 = 全局模型"
                    onChange={(e) => patch({ model: e.target.value || undefined })}
                  />
                </div>
              </div>
              <div className="field">
                <label>权限模式</label>
                <div className="field-control">
                  <select
                    value={selected.permissionMode ?? "auto"}
                    onChange={(e) =>
                      patch({
                        permissionMode: e.target.value as "auto" | "edit" | "manual",
                      })
                    }
                  >
                    <option value="auto">自动（完全自由）</option>
                    <option value="edit">编辑（写自由，运行需许可）</option>
                    <option value="manual">手动（写入和运行需许可）</option>
                  </select>
                </div>
              </div>
              <div className="field">
                <label>参数 temperature</label>
                <div className="field-control">
                  <input
                    type="number"
                    min={0}
                    max={2}
                    step={0.1}
                    value={typeof selected.params?.temperature === "number" ? String(selected.params.temperature) : ""}
                    placeholder="留空 = 不覆盖"
                    onChange={(e) => {
                      const v = e.target.value;
                      const params = { ...(selected.params ?? {}) };
                      if (v === "") delete params.temperature;
                      else params.temperature = Number(v);
                      patch({ params });
                    }}
                  />
                </div>
              </div>
              <div className="field">
                <label>记忆模块：大纲记忆</label>
                <div className="field-control">
                  <label className="agent-config-check">
                    <input
                      type="checkbox"
                      checked={selected.memory?.outlines !== false}
                      onChange={(e) => patch({ memory: { outlines: e.target.checked } })}
                    />
                    <span>生成大纲记忆（2-4 hook）</span>
                  </label>
                </div>
              </div>
              <div className="field">
                <label>工具集（白名单）</label>
                <div className="field-control">
                  <div className="agent-config-tool-grid">
                    {toolNames.map((t) => (
                      <label key={t} className="agent-config-tool">
                        <input
                          type="checkbox"
                          checked={selected.tools === null || selected.tools === undefined || selected.tools.includes(t)}
                          onChange={() => toggleTool(t)}
                        />
                        <span>{t}</span>
                      </label>
                    ))}
                  </div>
                </div>
              </div>
              <div className="field">
                <label>skill 集</label>
                <div className="field-control">
                  {BUILTIN_SKILLS.map((s) => (
                    <label key={s.id} className="agent-config-check" title={s.description}>
                      <input
                        type="checkbox"
                        checked={(selected.skills ?? []).includes(s.id)}
                        onChange={() => toggleSkill(s.id)}
                      />
                      <span>{s.name}</span>
                    </label>
                  ))}
                </div>
              </div>
              <div className="field">
                <label>专属文件池</label>
                <div className="field-control">
                  {(selected.filePool ?? []).length === 0 && <span className="muted">（空）</span>}
                  {(selected.filePool ?? []).map((p) => (
                    <span key={p} className="session-tag-chip">
                      {p}
                      <button title="移除" onClick={() => removePoolPath(p)}>×</button>
                    </span>
                  ))}
                  <input
                    placeholder="相对路径 + 回车添加"
                    value={poolInput}
                    onChange={(e) => setPoolInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") addPoolPath();
                    }}
                  />
                </div>
              </div>
              <div className="field">
                <label>代码插槽（v1 仅管理/预览，执行留阶段 4+）</label>
                <div className="field-control">
                  {(selected.filePool ?? []).map((p) => (
                    <button key={p} className="btn-ghost agent-config-pool-path" onClick={() => void previewFile(p)}>
                      预览 {p}
                    </button>
                  ))}
                  {preview && (
                    <div className="agent-config-code">
                      <div className="muted">{preview.path}</div>
                      {md ? (
                        <div
                          className="markdown-body"
                          dangerouslySetInnerHTML={{ __html: md.render(`\`\`\`\n${preview.raw}\n\`\`\``) }}
                        />
                      ) : (
                        <pre>{preview.raw}</pre>
                      )}
                      <button className="btn-ghost" onClick={saveToSlot}>
                        保存到插槽（slots.code）
                      </button>
                      {selected.slots?.code !== undefined && (
                        <span className="muted">已存（{String(selected.slots.code).length} 字符）</span>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      {/* 删除确认 */}
      {confirmDelete && (
        <div className="floating-mask" onClick={() => setConfirmDelete(false)}>
          <div className="confirm-box" onClick={(e) => e.stopPropagation()}>
            <p>确定删除 agent「{selected?.name ?? ""}」？此操作不可撤销。</p>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 12 }}>
              <button className="btn-ghost" onClick={() => setConfirmDelete(false)}>取消</button>
              <button className="btn" onClick={confirmDeleteProfile}>删除</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
