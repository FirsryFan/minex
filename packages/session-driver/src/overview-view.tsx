import type { MinexKernel } from "@minex/kernel";
import { useCallback, useEffect, useState } from "react";
import { createSession, type Session, type SessionIndexEntry } from "./session.js";
import type { SessionStore } from "./store.js";

interface PersonaLike {
  id: string;
  name: string;
}

/** 会话设置表单（R-A 反馈 8：标签 / 默认 agent / persona / systemPrompt；3-2：权限模式；3-3：模型/温度；F-C：agentProfileId） */
interface SettingsForm {
  tags: string[];
  agentProfileId: string;
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
  // 3-5：大纲查看（原会话系面板大纲 tab 并入）——设置弹窗内只读大纲列表
  const [settingsOutlines, setSettingsOutlines] = useState<Array<{ id: string; kind: string; summary: string }>>([]);
  // F-C：过滤栏重设计——标题搜索 + 漏斗 → 过滤卡片（标签多选/时间/大小/agent 四维 AND）
  const [filterOpen, setFilterOpen] = useState(false);
  const [tagSel, setTagSel] = useState<Set<string>>(new Set());
  const [timeSel, setTimeSel] = useState("");
  const [sizeSel, setSizeSel] = useState("");
  const [agentSel, setAgentSel] = useState("");
  const [filteredExtra, setFilteredExtra] = useState<SessionIndexEntry[] | null>(null);

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

  // F-C：同步过滤（标签多选 OR / 时间 / 大小 / 标题搜索——只匹配会话名）——纯 index 数据，快路径
  const q = query.trim().toLowerCase();
  const filtered = entries
    .filter((e) => (tagSel.size === 0 || e.tags.some((t) => tagSel.has(t))))
    .filter((e) => {
      if (!timeSel) return true;
      const age = Date.now() - Date.parse(e.updatedAt);
      if (timeSel === "today") return age < 86_400_000;
      if (timeSel === "7d") return age < 7 * 86_400_000;
      if (timeSel === "30d") return age < 30 * 86_400_000;
      return true;
    })
    .filter((e) => {
      if (!sizeSel) return true;
      if (sizeSel === "small") return e.nodeCount < 10;
      if (sizeSel === "medium") return e.nodeCount >= 10 && e.nodeCount <= 50;
      if (sizeSel === "large") return e.nodeCount > 50;
      return true;
    })
    .filter((e) => (q ? e.title.toLowerCase().includes(q) : true)) // F-C：只匹配会话名（去掉标签匹配）
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  // F-C：agent 维为异步阶段（逐个 loadSession 查 meta.agentProfileId；v1 零模型改动，量大后 index 扩展）
  useEffect(() => {
    let alive = true;
    if (!agentSel) {
      setFilteredExtra(filtered);
      return;
    }
    void (async () => {
      const out: SessionIndexEntry[] = [];
      for (const e of filtered) {
        const s = await store?.loadSession(e.id);
        if (!s) continue;
        const pid = s.meta.agentProfileId ?? "";
        if (agentSel === "__none__" ? pid !== "" : pid !== agentSel) continue;
        out.push(e);
      }
      if (alive) setFilteredExtra(out);
    })();
    return () => {
      alive = false;
    };
  }, [filtered, agentSel, store]);

  const shown = filteredExtra ?? filtered;

  // F-C：过滤卡片 Esc 关闭
  useEffect(() => {
    if (!filterOpen) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") setFilterOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [filterOpen]);

  const hasFilter = tagSel.size > 0 || timeSel !== "" || sizeSel !== "" || agentSel !== "";

  // F-C：agent 下拉选项 = AgentProfile 列表（经 agent.profile 能力桥接，跨包零源码 import）
  const profileCap = kernel.registry
    .get<{
      loadAgentProfiles(k: unknown): Record<string, { id: string; name: string; personaId?: string }>;
    }>("agent.profile", "default")?.value;
  const profiles = profileCap ? Object.values(profileCap.loadAgentProfiles(kernel)) : [];
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
    setSettingsOutlines((s.meta.outlines ?? []) as Array<{ id: string; kind: string; summary: string }>);
    setSettingsForm({
      tags: [...s.meta.tags],
      agentProfileId: s.meta.agentProfileId ?? "",
      personaId: s.meta.personaId ?? "",
      systemPrompt: s.meta.settings?.systemPrompt ?? "",
      permissionMode: s.meta.settings?.permissionMode ?? "auto",
      model: s.meta.settings?.model ?? "",
      temperature: s.meta.settings?.temperature !== undefined ? String(s.meta.settings.temperature) : "",
    });
  }

  /** 保存会话设置：不可变合并（tags / agentProfileId / personaId / settings）→ saveSession */
  async function saveSettings(): Promise<void> {
    if (!store || !settingsId || !settingsForm) return;
    const s = await store.loadSession(settingsId);
    if (!s) return;
    const next: Session = {
      ...s,
      activeAgents: ["minex.agent"], // F-C：档案关联保持 agent 驱动关联
      meta: {
        ...s.meta,
        tags: settingsForm.tags,
        ...(settingsForm.agentProfileId ? { agentProfileId: settingsForm.agentProfileId } : {}), // F-C
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
          placeholder="搜索会话名…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {/* F-C：漏斗过滤器（有任一过滤时高亮）——点击开/关过滤卡片 */}
        <button
          className={`session-filter-btn${hasFilter ? " active" : ""}`}
          title="过滤（标签/时间/大小/agent）"
          onClick={() => setFilterOpen((o) => !o)}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M3 5h18l-7 8v6l-4 2v-8L3 5z" />
          </svg>
        </button>
        <button className="btn session-new" title="新建会话" onClick={() => void createNew()}>＋</button>
      </div>

      {/* F-C：过滤卡片（四维 AND；标签多选 OR 语义） */}
      {filterOpen && (
        <div className="floating-mask" onClick={() => setFilterOpen(false)}>
          <div className="filter-card" onClick={(e) => e.stopPropagation()}>
            <div className="section-title">过滤会话</div>
            <div className="field">
              <label>标签（多选）</label>
              <div className="field-control">
                {tags.length === 0 ? (
                  <span className="muted">（无标签）</span>
                ) : (
                  <div className="session-tags">
                    {tags.map((t) => (
                      <button
                        key={t}
                        className={`session-tag${tagSel.has(t) ? " active" : ""}`}
                        onClick={() =>
                          setTagSel((prev) => {
                            const next = new Set(prev);
                            if (next.has(t)) next.delete(t);
                            else next.add(t);
                            return next;
                          })
                        }
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <div className="field">
              <label>时间（按更新）</label>
              <div className="field-control">
                <select value={timeSel} onChange={(e) => setTimeSel(e.target.value)}>
                  <option value="">全部</option>
                  <option value="today">今天</option>
                  <option value="7d">最近 7 天</option>
                  <option value="30d">最近 30 天</option>
                </select>
              </div>
            </div>
            <div className="field">
              <label>大小（消息数）</label>
              <div className="field-control">
                <select value={sizeSel} onChange={(e) => setSizeSel(e.target.value)}>
                  <option value="">全部</option>
                  <option value="small">小（&lt;10 节点）</option>
                  <option value="medium">中（10-50 节点）</option>
                  <option value="large">大（&gt;50 节点）</option>
                </select>
              </div>
            </div>
            <div className="field">
              <label>agent（档案）</label>
              <div className="field-control">
                <select value={agentSel} onChange={(e) => setAgentSel(e.target.value)}>
                  <option value="">全部</option>
                  {profiles.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                  <option value="__none__">未指定</option>
                </select>
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 10 }}>
              <button
                className="btn-ghost"
                onClick={() => {
                  setTagSel(new Set());
                  setTimeSel("");
                  setSizeSel("");
                  setAgentSel("");
                }}
              >
                清除过滤
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="session-list">
        {shown.length === 0 && <div className="muted session-empty">（无会话）</div>}
        {shown.map((e) => (
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
              <label>agent（档案，F-C）</label>
              <div className="field-control">
                <select
                  value={settingsForm.agentProfileId}
                  onChange={(e) => setSettingsForm((f) => (f ? { ...f, agentProfileId: e.target.value } : f))}
                >
                  <option value="">（未指定）</option>
                  {profiles.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="field">
              <label>persona</label>
              <div className="field-control">
                <select
                  value={
                    settingsForm.personaId ||
                    (profiles.find((p) => p.id === settingsForm.agentProfileId)?.personaId ?? "")
                  }
                  onChange={(e) => setSettingsForm((f) => (f ? { ...f, personaId: e.target.value } : f))}
                >
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
            <div className="field">
              <label>大纲（3-5 只读）</label>
              <div className="field-control">
                {settingsOutlines.length === 0 ? (
                  <span className="muted">（暂无大纲）</span>
                ) : (
                  <ul className="session-outlines">
                    {settingsOutlines.map((o) => (
                      <li key={o.id}>
                        <span className="session-outline-kind">{o.kind}</span>
                        <span>{o.summary}</span>
                      </li>
                    ))}
                  </ul>
                )}
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
