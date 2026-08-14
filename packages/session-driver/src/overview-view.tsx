import type { MinexKernel } from "@minex/kernel";
import { useCallback, useEffect, useState } from "react";
import { createSession, type Session, type SessionIndexEntry } from "./session.js";
import type { SessionStore } from "./store.js";

interface PersonaLike {
  id: string;
  name: string;
}

/** 会话设置表单（R-A 反馈 8：标签 / 默认 agent / persona / systemPrompt；3-2：权限模式；3-3：模型/温度） */
interface SettingsForm {
  tags: string[];
  agent: string;
  personaId: string;
  systemPrompt: string;
  permissionMode: "auto" | "edit" | "manual";
  model: string;
  temperature: string;
}

/**
 * 会话总览面板（S4 / 2-2 / R-A）：搜索 + 标签筛选 + 会话列表 + 新建。
 * 点击会话 → 对话模式（minex:openSession）；行内操作：删除（确认弹窗）+ 会话设置（R-A 反馈 8）。
 * 订阅 registry/dataChanged 刷新（保存/删除会话后列表立即更新）。
 */
export default function OverviewView({ kernel, instanceId }: { kernel: MinexKernel; instanceId?: number }) {
  const store = kernel.registry.get<SessionStore>("session", "default")?.value;
  const [entries, setEntries] = useState<SessionIndexEntry[]>([]);
  const [query, setQuery] = useState("");
  const [tag, setTag] = useState<string | null>(null);
  const [tags, setTags] = useState<string[]>([]);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [settingsId, setSettingsId] = useState<string | null>(null);
  const [settingsForm, setSettingsForm] = useState<SettingsForm | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    if (!store) return;
    const index = await store.loadIndex();
    setEntries(index.sessions);
    const all = new Set<string>();
    for (const e of index.sessions) for (const t of e.tags) all.add(t);
    setTags([...all]);
  }, [store]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // R-A 反馈 2：订阅刷新（保存/删除会话后列表立即更新）
  useEffect(() => {
    const offs: Array<() => void> = [];
    offs.push(kernel.registry.onChange("*", () => void refresh()));
    offs.push(kernel.events.on("minex:dataChanged", () => void refresh()));
    return () => offs.forEach((off) => off());
  }, [kernel, refresh]);

  const filtered = entries
    .filter((e) => (tag ? e.tags.includes(tag) : true))
    .filter((e) => {
      const q = query.trim().toLowerCase();
      if (!q) return true;
      return e.title.toLowerCase().includes(q) || e.tags.some((t) => t.toLowerCase().includes(q));
    })
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  const agentOptions = kernel.drivers
    .list()
    .filter((m) => m.manifest.hasWorkspace && kernel.drivers.getState(m.manifest.id) === "activated")
    .map((m) => ({ id: m.manifest.id, name: m.manifest.name }));
  const personaOptions = kernel.registry.query<PersonaLike>("role").map((c) => c.value);

  async function createNew(): Promise<void> {
    if (!store) return;
    const s = createSession({ title: "新会话" });
    await store.saveSession(s);
    await refresh();
    kernel.events.emit("minex:openSession", { id: s.meta.id, targetInstanceId: instanceId });
  }

  /** 对话模式：emit minex:openSession → 顶栏切 Agent + ChatView 会话模式打开 */
  function openChat(id: string): void {
    kernel.events.emit("minex:openSession", { id, targetInstanceId: instanceId });
  }

  async function confirmDelete(): Promise<void> {
    if (!store || !deleteId) return;
    await store.deleteSession(deleteId);
    setDeleteId(null);
    await refresh();
  }

  /** 打开会话设置弹窗：加载会话 → 表单初值 */
  async function openSettings(id: string): Promise<void> {
    if (!store) return;
    const s = await store.loadSession(id);
    if (!s) return;
    setSettingsId(id);
    setSettingsForm({
      tags: [...s.meta.tags],
      agent: s.activeAgents[0] ?? "minex.agent",
      personaId: s.meta.personaId ?? "",
      systemPrompt: s.meta.settings?.systemPrompt ?? "",
      permissionMode: s.meta.settings?.permissionMode ?? "auto",
      model: s.meta.settings?.model ?? "",
      temperature: s.meta.settings?.temperature !== undefined ? String(s.meta.settings.temperature) : "",
    });
  }

  /** 保存会话设置：不可变合并（tags / activeAgents / personaId / settings.systemPrompt）→ saveSession */
  async function saveSettings(): Promise<void> {
    if (!store || !settingsId || !settingsForm) return;
    const s = await store.loadSession(settingsId);
    if (!s) return;
    const next: Session = {
      ...s,
      activeAgents: [settingsForm.agent],
      meta: {
        ...s.meta,
        tags: settingsForm.tags,
        ...(settingsForm.personaId ? { personaId: settingsForm.personaId } : {}),
        settings: {
          ...(s.meta.settings ?? {}),
          ...(settingsForm.systemPrompt ? { systemPrompt: settingsForm.systemPrompt } : {}),
          permissionMode: settingsForm.permissionMode, // 3-2：恒写（下拉总有值，缺省 auto）
          ...(settingsForm.model ? { model: settingsForm.model } : {}), // 3-3：空值不写
          ...(settingsForm.temperature !== "" ? { temperature: Number(settingsForm.temperature) } : {}),
        },
        updatedAt: new Date().toISOString(),
      },
    };
    await store.saveSession(next);
    setSettingsId(null);
    setSettingsForm(null);
    await refresh();
  }

  function addTag(text: string): void {
    const t = text.trim();
    if (!t || settingsForm!.tags.includes(t)) return;
    setSettingsForm((f) => (f ? { ...f, tags: [...f.tags, t] } : f));
  }
  function removeTag(t: string): void {
    setSettingsForm((f) => (f ? { ...f, tags: f.tags.filter((x) => x !== t) } : f));
  }

  return (
    <div className="session-overview">
      <div className="session-overview-head">
        <input
          className="session-search"
          placeholder="搜索会话…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button className="btn session-new" title="新建会话" onClick={() => void createNew()}>＋</button>
      </div>
      {tags.length > 0 && (
        <div className="session-tags">
          <button className={`session-tag${!tag ? " active" : ""}`} onClick={() => setTag(null)}>全部</button>
          {tags.map((t) => (
            <button key={t} className={`session-tag${tag === t ? " active" : ""}`} onClick={() => setTag(t === tag ? null : t)}>
              {t}
            </button>
          ))}
        </div>
      )}
      <div className="session-list">
        {filtered.length === 0 && <div className="muted session-empty">（无会话）</div>}
        {filtered.map((e) => (
          <div key={e.id} className="session-item" onClick={() => openChat(e.id)} title={`对话：${e.type} · ${e.nodeCount} 节点 · ${e.updatedAt}`}>
            <div className="session-item-title">{e.title}</div>
            <div className="session-item-meta muted">{e.tags.length ? e.tags.join(" · ") : e.type} · {e.nodeCount} 节点</div>
            <span className="session-item-actions">
              <button
                className="session-item-btn"
                title="会话设置"
                onClick={(ev) => {
                  ev.stopPropagation();
                  void openSettings(e.id);
                }}
              >
                ⚙
              </button>
              <button
                className="session-item-btn danger"
                title="删除会话"
                onClick={(ev) => {
                  ev.stopPropagation();
                  setDeleteId(e.id);
                }}
              >
                🗑
              </button>
            </span>
          </div>
        ))}
      </div>

      {/* 删除确认（ConfirmModal 模式） */}
      {deleteId && (
        <div className="floating-mask" onClick={() => setDeleteId(null)}>
          <div className="confirm-box" onClick={(e) => e.stopPropagation()}>
            <p>确定删除该会话？此操作不可撤销。</p>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 12 }}>
              <button className="btn-ghost" onClick={() => setDeleteId(null)}>取消</button>
              <button className="btn" onClick={() => void confirmDelete()}>删除</button>
            </div>
          </div>
        </div>
      )}

      {/* 会话设置弹窗（R-A 反馈 8） */}
      {settingsId && settingsForm && (
        <div className="floating-mask" onClick={() => setSettingsId(null)}>
          <div className="confirm-box session-settings" onClick={(e) => e.stopPropagation()}>
            <div className="section-title">会话设置</div>
            <div className="field">
              <label>标签</label>
              <div className="field-control session-settings-tags">
                {settingsForm.tags.map((t) => (
                  <span key={t} className="session-tag-chip">
                    {t}
                    <button title="移除标签" onClick={() => removeTag(t)}>×</button>
                  </span>
                ))}
                <input
                  placeholder="+ 标签（回车添加）"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      addTag((e.target as HTMLInputElement).value);
                      (e.target as HTMLInputElement).value = "";
                    }
                  }}
                />
              </div>
            </div>
            <div className="field">
              <label>默认 agent</label>
              <div className="field-control">
                <select value={settingsForm.agent} onChange={(e) => setSettingsForm((f) => (f ? { ...f, agent: e.target.value } : f))}>
                  {agentOptions.map((d) => (
                    <option key={d.id} value={d.id}>{d.name}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="field">
              <label>persona</label>
              <div className="field-control">
                <select value={settingsForm.personaId} onChange={(e) => setSettingsForm((f) => (f ? { ...f, personaId: e.target.value } : f))}>
                  <option value="">（不指定）</option>
                  {personaOptions.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="field">
              <label>systemPrompt</label>
              <div className="field-control">
                <textarea
                  rows={4}
                  value={settingsForm.systemPrompt}
                  placeholder="留空 = 使用 persona 的默认提示词"
                  onChange={(e) => setSettingsForm((f) => (f ? { ...f, systemPrompt: e.target.value } : f))}
                />
              </div>
            </div>
            <div className="field">
              <label>权限模式（3-2）</label>
              <div className="field-control">
                <select
                  value={settingsForm.permissionMode}
                  onChange={(e) =>
                    setSettingsForm((f) =>
                      f ? { ...f, permissionMode: e.target.value as SettingsForm["permissionMode"] } : f,
                    )
                  }
                >
                  <option value="auto">自动（完全自由）</option>
                  <option value="edit">编辑（写自由，运行需许可）</option>
                  <option value="manual">手动（写入和运行需许可）</option>
                </select>
              </div>
            </div>
            <div className="field">
              <label>模型（3-3）</label>
              <div className="field-control">
                <input
                  value={settingsForm.model}
                  placeholder="留空 = 使用全局配置的模型"
                  onChange={(e) => setSettingsForm((f) => (f ? { ...f, model: e.target.value } : f))}
                />
              </div>
            </div>
            <div className="field">
              <label>温度（3-3，0-2）</label>
              <div className="field-control">
                <input
                  type="number"
                  min={0}
                  max={2}
                  step={0.1}
                  value={settingsForm.temperature}
                  placeholder="留空 = 不覆盖"
                  onChange={(e) => setSettingsForm((f) => (f ? { ...f, temperature: e.target.value } : f))}
                />
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 12 }}>
              <button className="btn-ghost" onClick={() => setSettingsId(null)}>取消</button>
              <button className="btn" onClick={() => void saveSettings()}>保存</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
