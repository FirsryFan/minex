import {
  SESSION_VERSION,
  toIndexEntry,
  validateSession,
  validateSessionIndex,
  validateType,
  type Session,
  type SessionIndex,
  type SessionIndexEntry,
} from "./session.js";

/** filesystem 能力中 session 用到的子集（结构类型，避免跨包 import）。 */
export interface SessionFsOps {
  hasRoot(): boolean;
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  /** 建目录（会话按 type 分文件夹存储） */
  ensureDir(path: string): Promise<void>;
}

export interface SessionStore {
  hasRoot(): boolean;
  loadIndex(): Promise<SessionIndex>;
  listSessions(): Promise<SessionIndexEntry[]>;
  loadSession(id: string): Promise<Session | undefined>;
  saveSession(s: Session): Promise<void>;
  deleteSession(id: string): Promise<void>;
  /** 会话 .ses 文件路径（供打开路由复用路径约定，审查 phase28 m2） */
  sessionPath(type: string, id: string): string;
}

const MIST_DIR = ".mist";
const SESSIONS_DIR = "sessions";
const INDEX_FILE = "index.json";

/**
 * 会话存储（基于 filesystem 能力，浏览器 File System Access / Node 同一接口）。
 * 目录：`.mist/sessions/<type>/<id>.ses`（会话正文，按 type 分文件夹）+ `.mist/index.json`（轻量索引）。
 * 总览/搜索读索引（O(1)），不逐个扫描正文文件。
 */
export function createSessionStore(fs: SessionFsOps): SessionStore {
  const sessionPath = (type: string, id: string): string => `${MIST_DIR}/${SESSIONS_DIR}/${type}/${id}.ses`;
  const indexPath = `${MIST_DIR}/${INDEX_FILE}`;

  async function loadIndex(): Promise<SessionIndex> {
    try {
      const raw = await fs.readFile(indexPath);
      const parsed = JSON.parse(raw) as unknown;
      return validateSessionIndex(parsed) ? parsed : emptyIndex();
    } catch {
      return emptyIndex();
    }
  }

  /** 保存会话：写 .ses + 同步更新索引（写文件后单点更新，防索引与正文漂移）。 */
  async function saveSession(s: Session): Promise<void> {
    if (!validateType(s.meta.type)) {
      throw new Error(`非法会话类型（用于路径段）：${s.meta.type}`);
    }
    await fs.ensureDir(`${MIST_DIR}/${SESSIONS_DIR}/${s.meta.type}`);
    await fs.writeFile(sessionPath(s.meta.type, s.meta.id), JSON.stringify(s, null, 2));
    const index = await loadIndex();
    const entry = toIndexEntry(s);
    const sessions = [entry, ...index.sessions.filter((e) => e.id !== s.meta.id)];
    await fs.writeFile(indexPath, JSON.stringify({ version: SESSION_VERSION, sessions }, null, 2));
  }

  async function loadSession(id: string): Promise<Session | undefined> {
    const index = await loadIndex();
    const entry = index.sessions.find((e) => e.id === id);
    if (!entry) return undefined;
    try {
      const raw = await fs.readFile(sessionPath(entry.type, entry.id));
      const parsed = JSON.parse(raw) as unknown;
      return validateSession(parsed) ? parsed : undefined;
    } catch {
      return undefined;
    }
  }

  /** 删除会话：v1 仅从索引移除（正文文件删除待 filesystem 提供 removeFile 后补充）。 */
  async function deleteSession(id: string): Promise<void> {
    const index = await loadIndex();
    const sessions = index.sessions.filter((e) => e.id !== id);
    await fs.writeFile(indexPath, JSON.stringify({ version: SESSION_VERSION, sessions }, null, 2));
  }

  return {
    hasRoot: () => fs.hasRoot(),
    loadIndex,
    listSessions: async () => (await loadIndex()).sessions,
    loadSession,
    saveSession,
    deleteSession,
    sessionPath: (type, id) => sessionPath(type, id),
  };
}

function emptyIndex(): SessionIndex {
  return { version: SESSION_VERSION, sessions: [] };
}
