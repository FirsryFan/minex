/**
 * Mist 会话数据模型与纯函数（.ses 文件格式）。
 *
 * 会话 = 图结构：nodes（卡片）+ links（边）+ meta + 关联 agent。
 * 设计要点（为非线性对话 / 多 agent 工作流 / 单会话切 agent 预留）：
 * - 会话与 agent 是两个独立层次，会话经 activeAgents 链接引用 agent（不内嵌）。
 * - nodes.kind 预留 agent-msg（agent 间消息，multiagent 溯源）与 event。
 * - links.type 预留 branch / assign / agent-flow（非线性跳转 / 指派 / agent 工作流）。
 *
 * 所有操作不可变：返回新 Session，不改入参（React 状态安全、测试友好）。
 */

export type SessionNodeKind = "user" | "assistant" | "tool" | "agent-msg" | "event";

export type SessionLinkType = "responds" | "branch" | "assign" | "agent-flow";

import { validateOutlineEntry } from "./session-tree.js";
import type { OutlineEntry } from "./session-tree.js";

export interface SessionNode {
  id: string;
  kind: SessionNodeKind;
  /** assistant / tool / agent-msg 卡片归属的 agent（multiagent 溯源） */
  agentId?: string;
  content?: string;
  toolName?: string;
  input?: unknown;
  output?: unknown;
  error?: string;
  ts: string;
}

export interface SessionLink {
  from: string;
  to: string;
  type: SessionLinkType;
}

/** 会话级设置（2-2：v1 只存不用——阶段 3 模型参数接线时消费；缺省默认） */
export interface SessionSettings {
  model?: string;
  temperature?: number;
  contextStrategy?: "branch" | "full";
}

export interface SessionMeta {
  id: string;
  type: string;
  title: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  /** 当前分支（HEAD，视图指针，不落盘持久语义；缺省 = 主链，旧数据兼容） */
  currentBranchId?: string;
  /** 大纲记忆（D4 Envelope 式条目，task 2-1；可选，旧数据兼容） */
  outlines?: OutlineEntry[];
  /** 会话级设置（2-2；可选，旧数据兼容） */
  settings?: SessionSettings;
  /** 父会话 id（会话系图谱真相源，P3：子会话创建时写入；可选，旧数据兼容） */
  parentSessionId?: string;
  /** 会话采用的 persona id（P1：浮窗选择器选定写入；可选，旧数据兼容） */
  personaId?: string;
}

export interface Session {
  meta: SessionMeta;
  activeAgents: string[];
  nodes: SessionNode[];
  links: SessionLink[];
}

export interface SessionIndexEntry {
  id: string;
  type: string;
  title: string;
  tags: string[];
  updatedAt: string;
  nodeCount: number;
}

export interface SessionIndex {
  version: 1;
  sessions: SessionIndexEntry[];
}

export const SESSION_VERSION = 1;

/** 会话 type 用于文件夹路径段：仅允许小写字母/数字/连字符/下划线（防路径穿越），最长 32 字符。 */
export function validateType(type: string): boolean {
  return /^[a-z0-9_-]{1,32}$/.test(type);
}

/** 新建会话（id/时间可注入以便测试；type 默认 chat，title 默认「未命名会话」）。 */
export function createSession(input: {
  id?: string;
  type?: string;
  title?: string;
  tags?: string[];
  activeAgents?: string[];
  now?: string;
}): Session {
  const now = input.now ?? new Date().toISOString();
  return {
    meta: {
      id: input.id ?? randomId(),
      type: input.type ?? "chat",
      title: input.title ?? "未命名会话",
      tags: [...(input.tags ?? [])],
      createdAt: now,
      updatedAt: now,
    },
    activeAgents: [...(input.activeAgents ?? [])],
    nodes: [],
    links: [],
  };
}

/** 追加节点（不可变），并刷新 updatedAt。 */
export function addNode(s: Session, node: SessionNode, now?: string): Session {
  const updatedAt = now ?? new Date().toISOString();
  return { ...s, nodes: [...s.nodes, node], meta: { ...s.meta, updatedAt } };
}

/** 加链接（不可变）；同 from/to/type 的重复链接忽略。 */
export function addLink(s: Session, link: SessionLink): Session {
  if (s.links.some((l) => l.from === link.from && l.to === link.to && l.type === link.type)) return s;
  return { ...s, links: [...s.links, link] };
}

/** 删除节点（不可变），并清理所有指向/出自它的链接。 */
export function removeNode(s: Session, nodeId: string, now?: string): Session {
  const updatedAt = now ?? new Date().toISOString();
  return {
    ...s,
    nodes: s.nodes.filter((n) => n.id !== nodeId),
    links: s.links.filter((l) => l.from !== nodeId && l.to !== nodeId),
    meta: { ...s.meta, updatedAt },
  };
}

/** 改元数据（不可变），刷新 updatedAt。 */
export function updateMeta(
  s: Session,
  patch: Partial<Pick<SessionMeta, "title" | "tags" | "type">>,
  now?: string,
): Session {
  const updatedAt = now ?? new Date().toISOString();
  return { ...s, meta: { ...s.meta, ...patch, updatedAt } };
}

/** 会话 → 索引轻量条目（总览/搜索只读它，不读正文）。 */
export function toIndexEntry(s: Session): SessionIndexEntry {
  return {
    id: s.meta.id,
    type: s.meta.type,
    title: s.meta.title,
    tags: [...s.meta.tags],
    updatedAt: s.meta.updatedAt,
    nodeCount: s.nodes.length,
  };
}

/** 索引搜索：标题 / 标签 / id 子串匹配（不区分大小写）；空查询返回全部。 */
export function searchSessions(index: SessionIndex, query: string): SessionIndexEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return index.sessions;
  return index.sessions.filter(
    (e) =>
      e.title.toLowerCase().includes(q) ||
      e.tags.some((t) => t.toLowerCase().includes(q)) ||
      e.id.toLowerCase().includes(q),
  );
}

/** 按标签过滤索引；tag 为 null/空返回全部。 */
export function filterByTag(index: SessionIndex, tag: string | null): SessionIndexEntry[] {
  if (!tag) return index.sessions;
  return index.sessions.filter((e) => e.tags.includes(tag));
}

/**
 * 主链渲染为 markdown（供 markdown 编辑器原生打开会话）。
 * v1：按节点创建顺序线性拼接；非线性主链（responds 链跟随）待画布阶段精化。
 */
export function toMarkdown(s: Session): string {
  const parts: string[] = [`# ${s.meta.title}`];
  for (const n of s.nodes) {
    if (n.kind === "user") {
      parts.push(`## 你\n\n${n.content ?? ""}`);
    } else if (n.kind === "assistant") {
      parts.push(`## ${n.agentId ?? "助手"}\n\n${n.content ?? ""}`);
    } else if (n.kind === "tool") {
      parts.push(
        `### 工具调用：${n.toolName ?? "?"}\n\n\`\`\`json\n${JSON.stringify(
          { input: n.input, output: n.output, error: n.error ?? undefined },
          null,
          2,
        )}\n\`\`\``,
      );
    } else {
      parts.push(`> ${n.content ?? n.toolName ?? n.kind}`);
    }
  }
  return parts.join("\n\n");
}

/**
 * markdown → 主链节点（供 markdown 编辑器编辑 .ses 后回写）。
 * 约定与 toMarkdown 互逆：`## 你` = user 块，`## <agentId>` = assistant 块；一级 `# 标题` 忽略。
 * v1：`### 工具调用` 等非标题行并入当前块 content（工具/事件节点的图内编辑走画布视图）。
 */
export function parseMainChain(doc: string, ts?: string): SessionNode[] {
  const stamp = ts ?? new Date().toISOString();
  const nodes: SessionNode[] = [];
  let block: { kind: SessionNodeKind; agentId?: string; content: string[] } | null = null;

  const flush = (): void => {
    if (!block) return;
    nodes.push({
      id: randomId(),
      kind: block.kind,
      ...(block.agentId ? { agentId: block.agentId } : {}),
      content: block.content.join("\n").trim(),
      ts: stamp,
    });
    block = null;
  };

  for (const line of doc.split("\n")) {
    const head = line.match(/^##\s+(.*)$/);
    if (head) {
      flush();
      const who = head[1].trim();
      if (who === "你") {
        block = { kind: "user", content: [] };
      } else {
        // `## 助手` 归一化为无 agentId（与 toMarkdown 的无 agentId 渲染互逆，审查 phase25 m1）
        block = { kind: "assistant", ...(who === "助手" ? {} : { agentId: who }), content: [] };
      }
    } else if (block) {
      block.content.push(line);
    }
  }
  flush();
  return nodes;
}

/** 线性 responds 链：后一节点 responds 前一节点。 */
export function buildLinearLinks(nodes: SessionNode[]): SessionLink[] {
  const links: SessionLink[] = [];
  for (let i = 1; i < nodes.length; i++) {
    links.push({ from: nodes[i].id, to: nodes[i - 1].id, type: "responds" });
  }
  return links;
}

/** 从 markdown 主链整体重建会话：保留 meta（title/tags/type/id）与 activeAgents，替换 nodes 并重建线性 links。 */
export function rebuildFromMarkdown(s: Session, doc: string, now?: string): Session {
  const updatedAt = now ?? new Date().toISOString();
  const nodes = parseMainChain(doc, updatedAt);
  return {
    ...s,
    nodes,
    links: buildLinearLinks(nodes),
    meta: { ...s.meta, updatedAt },
  };
}

/** 校验 .ses 文件内容是否为合法 Session（结构校验；meta.type 必须为合法路径段，自包含防穿越）。 */
export function validateSession(data: unknown): data is Session {
  if (typeof data !== "object" || data === null) return false;
  const s = data as Record<string, unknown>;
  const m = s.meta;
  if (typeof m !== "object" || m === null) return false;
  const meta = m as Record<string, unknown>;
  if (typeof meta.id !== "string" || typeof meta.title !== "string") return false;
  if (typeof meta.type !== "string" || !validateType(meta.type)) return false;
  if (!Array.isArray(meta.tags) || (meta.tags as unknown[]).some((t) => typeof t !== "string")) return false;
  // 2-1 扩展（可选字段，旧数据不受影响）：currentBranchId 必须 string；outlines 逐条形状校验
  if (meta.currentBranchId !== undefined && typeof meta.currentBranchId !== "string") return false;
  if (
    meta.outlines !== undefined &&
    (!Array.isArray(meta.outlines) || !(meta.outlines as unknown[]).every(validateOutlineEntry))
  ) {
    return false;
  }
  // 2-2 扩展：settings 可选形状校验（model string / temperature number / contextStrategy 枚举）
  if (meta.settings !== undefined) {
    const st = meta.settings as Record<string, unknown>;
    if (typeof st !== "object" || st === null) return false;
    if (st.model !== undefined && typeof st.model !== "string") return false;
    if (st.temperature !== undefined && typeof st.temperature !== "number") return false;
    if (st.contextStrategy !== undefined && st.contextStrategy !== "branch" && st.contextStrategy !== "full") return false;
  }
  // 2-1 修订扩展：parentSessionId / personaId 可选（出现则必须 string，旧数据不出现即兼容）
  if (meta.parentSessionId !== undefined && typeof meta.parentSessionId !== "string") return false;
  if (meta.personaId !== undefined && typeof meta.personaId !== "string") return false;
  if (!Array.isArray(s.activeAgents) || (s.activeAgents as unknown[]).some((a) => typeof a !== "string")) return false;
  if (!Array.isArray(s.nodes) || !Array.isArray(s.links)) return false;
  for (const n of s.nodes as unknown[]) {
    if (typeof n !== "object" || n === null) return false;
    const node = n as Record<string, unknown>;
    if (typeof node.id !== "string" || typeof node.kind !== "string" || typeof node.ts !== "string") return false;
  }
  for (const l of s.links as unknown[]) {
    if (typeof l !== "object" || l === null) return false;
    const link = l as Record<string, unknown>;
    if (typeof link.from !== "string" || typeof link.to !== "string" || typeof link.type !== "string") return false;
  }
  return true;
}

/** 校验索引文件结构。 */
export function validateSessionIndex(data: unknown): data is SessionIndex {
  if (typeof data !== "object" || data === null) return false;
  const idx = data as Record<string, unknown>;
  if (idx.version !== SESSION_VERSION || !Array.isArray(idx.sessions)) return false;
  for (const e of idx.sessions as unknown[]) {
    if (typeof e !== "object" || e === null) return false;
    const entry = e as Record<string, unknown>;
    if (typeof entry.id !== "string" || typeof entry.type !== "string" || typeof entry.title !== "string") return false;
    if (!Array.isArray(entry.tags) || (entry.tags as unknown[]).some((t) => typeof t !== "string")) return false;
  }
  return true;
}

function randomId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `s-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
