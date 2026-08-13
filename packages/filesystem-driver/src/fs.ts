import { joinPath, resolveSafePath } from "./path.js";

export interface FsEntry {
  name: string;
  path: string;
  isDirectory: boolean;
}

/** 文件系统能力（供 markdown / agent 等驱动复用）。所有路径相对根目录，经 resolveSafePath 校验。 */
export interface FileSystemAbility {
  hasRoot(): boolean;
  openRoot(): Promise<void>;
  readDir(path: string): Promise<FsEntry[]>;
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
}

/**
 * 浏览器实现：File System Access API（showDirectoryPicker 选根，读写限制在根内）。
 * Node/Electron 实现留待桌面版落地（接口一致，替换 createFileSystem 实现即可）。
 */
export function createBrowserFileSystem(): FileSystemAbility {
  let root: FileSystemDirectoryHandle | null = null;

  async function requireRoot(): Promise<FileSystemDirectoryHandle> {
    if (!root) throw new Error("尚未打开文件夹");
    return root;
  }

  async function resolveDir(path: string): Promise<FileSystemDirectoryHandle> {
    const safe = resolveSafePath(path);
    let dir = await requireRoot();
    if (safe) {
      for (const seg of safe.split("/")) {
        dir = await dir.getDirectoryHandle(seg);
      }
    }
    return dir;
  }

  return {
    hasRoot() {
      return root !== null;
    },
    async openRoot() {
      root = await showDirectoryPicker();
    },
    async readDir(path) {
      const dir = await resolveDir(path);
      const entries: FsEntry[] = [];
      for await (const [name, handle] of dir.entries()) {
        entries.push({ name, path: joinPath(path, name), isDirectory: handle.kind === "directory" });
      }
      return entries.sort((a, b) => (a.isDirectory === b.isDirectory ? a.name.localeCompare(b.name) : a.isDirectory ? -1 : 1));
    },
    async readFile(path) {
      const safe = resolveSafePath(path);
      const dir = await resolveDir(parentOf(safe));
      const file = await dir.getFileHandle(nameOf(safe));
      return await (await file.getFile()).text();
    },
    async writeFile(path, content) {
      const safe = resolveSafePath(path);
      const dir = await resolveDir(parentOf(safe));
      const file = await dir.getFileHandle(nameOf(safe), { create: true });
      const w = await file.createWritable();
      await w.write(content);
      await w.close();
    },
  };
}

function parentOf(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx === -1 ? "" : path.slice(0, idx);
}
function nameOf(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx === -1 ? path : path.slice(idx + 1);
}
