import type { MinexKernel } from "@minex/kernel";
import { useCallback, useEffect, useState } from "react";
import { createSession, type SessionIndexEntry } from "./session.js";
import type { SessionStore } from "./store.js";

/**
 * 会话总览面板（S4）：搜索 + 标签筛选 + 会话列表 + 新建。
 * 点击会话 → emit `filesystem:openFile`（.ses 路径）→ markdown 编辑器打开主链。
 * 数据走 `session` 能力（store.loadIndex，只读轻量索引，不扫描正文）。
 */
export default function OverviewView({ kernel, instanceId }: { kernel: MinexKernel; instanceId?: number }) {
  const store = kernel.registry.get<SessionStore>("session", "default")?.value;
  const [entries, setEntries] = useState<SessionIndexEntry[]>([]);
  const [query, setQuery] = useState("");
  const [tag, setTag] = useState<string | null>(null);
  const [tags, setTags] = useState<string[]>([]);

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

  const filtered = entries
    .filter((e) => (tag ? e.tags.includes(tag) : true))
    .filter((e) => {
      const q = query.trim().toLowerCase();
      if (!q) return true;
      return e.title.toLowerCase().includes(q) || e.tags.some((t) => t.toLowerCase().includes(q));
    })
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  async function createNew(): Promise<void> {
    if (!store) return;
    const s = createSession({ title: "新会话" });
    await store.saveSession(s);
    await refresh();
    openSession(s.meta.type, s.meta.id);
  }

  function openSession(type: string, id: string): void {
    // 用 store.sessionPath 复用路径约定（审查 phase28 m2）；openFile 定向本实例（phase30 第3步）
    const path = store?.sessionPath(type, id);
    if (path) kernel.events.emit("filesystem:openFile", { path, targetInstanceId: instanceId });
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
          <div
            key={e.id}
            className="session-item"
            onClick={() => openSession(e.type, e.id)}
            title={`${e.type} · ${e.nodeCount} 节点 · ${e.updatedAt}`}
          >
            <div className="session-item-title">{e.title}</div>
            <div className="session-item-meta muted">{e.tags.length ? e.tags.join(" · ") : e.type} · {e.nodeCount} 节点</div>
          </div>
        ))}
      </div>
    </div>
  );
}
