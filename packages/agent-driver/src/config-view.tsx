import { useEffect, useMemo, useState } from "react";
import type { MinexKernel } from "@minex/kernel";
import {
  BUILTIN_SKILLS,
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
 * Agent 配置中心（F-D 反馈 3 + P0-3）：纯表单（左栏列表已独立为 minex.agent.list 面板）。
 * 选中由 `minex:selectAgentProfile { id }` 事件驱动（列表面板 emit）；初始 = 首个 profile。
 * 代码插槽：filePool 路径点击 → filesystem 读 → markdown 渲染代码块预览 → 「保存到插槽」写 slots.code
 * （slots.code v1 仅管理/预览，不注入 agent——执行留阶段 4+）。保存/删除联动 emit minex:dataChanged。
 */
export default function AgentConfigView({ kernel, instanceId }: { kernel: MinexKernel; instanceId?: number }) {
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
  const [savedTick, setSavedTick] = useState(false);
  const [poolInput, setPoolInput] = useState("");
  const [preview, setPreview] = useState<{ path: string; raw: string } | null>(null);

  // P0-3：左栏列表选中 → 切换表单；dataChanged（列表新建/删除/保存）→ 刷新 profiles 并保持选中
  useEffect(() => {
    return kernel.events.on("minex:selectAgentProfile", (payload) => {
      const p = payload as { id?: string } | undefined;
      const id = p?.id ?? "";
      setSelectedId(id || null);
      setDraft(id ? (loadAgentProfiles(kernel)[id] ?? null) : null);
      setPreview(null);
    });
  }, [kernel]);

  useEffect(() => {
    return kernel.events.on("minex:dataChanged", () => {
      const all = loadAgentProfiles(kernel);
      setProfiles(all);
      // 保持当前选中：若仍存在则刷新 draft（外部保存/改名），否则清空
      setDraft((d) => {
        if (!d) return null;
        return all[d.id] ?? null;
      });
    });
  }, [kernel]);

  const selected = draft ?? null;

  function patch(p: Partial<AgentProfile>): void {
    setDraft((d) => (d ? { ...d, ...p } : d));
  }

  function save(): void {
    if (!selected) return;
    saveAgentProfile(kernel, selected);
    setProfiles(loadAgentProfiles(kernel));
    kernel.events.emit("minex:dataChanged", { driverId: "minex.agent" }); // 列表联动刷新
    setSavedTick(true);
    window.setTimeout(() => setSavedTick(false), 1200);
  }

  /** 工具白名单切换（null=全部；点掉一个转自定义；全勾回 null） */
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

  function addPoolPath(): void {
    const t = poolInput.trim();
    if (!t) return;
    patch({ filePool: [...(selected?.filePool ?? []), t] });
    setPoolInput("");
  }
  function removePoolPath(p: string): void {
    patch({ filePool: (selected?.filePool ?? []).filter((x) => x !== p) });
  }

  async function previewFile(path: string): Promise<void> {
    if (!fs) {
      setPreview({ path, raw: "尚未打开文件夹或文件系统不可用" });
      return;
    }
    try {
      const raw = await fs.readFile(path);
      setPreview({ path, raw });
    } catch (err) {
      setPreview({ path, raw: `读取失败：${err instanceof Error ? err.message : String(err)}` });
    }
  }

  function saveToSlot(): void {
    if (!preview) return;
    patch({ slots: { ...(selected?.slots ?? {}), code: preview.raw } });
  }

  const avatarText = selected?.avatar ?? (selected?.name ? selected.name.slice(0, 1) : "?");

  return (
    <div className="agent-config-form agent-config-form-solo">
      {!selected ? (
        <div className="muted">在左侧 Agents 列表选择或新建一个 agent</div>
      ) : (
        <>
          <div className="agent-config-form-head">
            <span className="agent-config-avatar">{selected.avatar ?? selected.name.slice(0, 1)}</span>
            <strong>{selected.name}</strong>
            <span className="muted">{selected.id}</span>
            {/* P1-6：设为当前会话 persona（emit 带 targetInstanceId——只影响本实例聊天） */}
            <button
              className="btn-ghost"
              title="把该档案的 persona 设为当前实例聊天的 persona"
              disabled={!selected.personaId}
              onClick={() =>
                kernel.events.emit("minex:setPersona", {
                  personaId: selected.personaId ?? "",
                  targetInstanceId: instanceId,
                })
              }
            >
              设为当前会话 persona
            </button>
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
                  placeholder={`留空用首字（${avatarText}）`}
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
                  placeholder="留空使用默认"
                  onChange={(e) => patch({ systemPrompt: e.target.value || undefined })}
                />
              </div>
            </div>
            <div className="field">
              <label>模型</label>
              <div className="field-control">
                <input
                  value={selected.model ?? ""}
                  placeholder="留空使用全局"
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
                  placeholder="留空不覆盖"
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
                {(selected.filePool ?? []).length === 0 && <span className="muted">空</span>}
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
  );
}
