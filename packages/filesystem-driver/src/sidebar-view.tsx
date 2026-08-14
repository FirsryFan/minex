import type { MinexKernel } from "@minex/kernel";
import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { ChevronDown, ChevronRight, File, FileCode, FileCog, FileImage, FileText } from "lucide-react";
import type { FileSystemAbility, FsEntry } from "./fs.js";
import { isMarkdownFile, isSessionFile } from "./path.js";

interface FsNode extends FsEntry {
  children?: FsNode[];
  loaded?: boolean;
  expanded?: boolean;
}

/** 文件树隐藏点开头的隐藏项（如 .mist 数据目录、.git 等） */
const visible = (e: FsEntry): boolean => !e.name.startsWith(".");

/** 文件系统侧边栏：打开文件夹 → 以根展开的文件树。点击 markdown 文件 → 广播打开事件给 markdown 驱动。 */
export default function SidebarView({ kernel, instanceId }: { kernel: MinexKernel; instanceId?: number }) {
  const [fs] = useState<FileSystemAbility>(() => kernel.registry.get<FileSystemAbility>("filesystem", "default")!.value);
  const [hasRoot, setHasRoot] = useState(fs.hasRoot());
  const [tree, setTree] = useState<FsNode[]>([]);

  const loadChildren = useCallback(
    async (node: FsNode): Promise<FsNode[]> => {
      const entries = await fs.readDir(node.path);
      return entries.filter(visible).map((e) => ({ ...e, loaded: false, expanded: false }));
    },
    [fs],
  );

  async function openRoot(): Promise<void> {
    await fs.openRoot();
    setHasRoot(true);
    const entries = await fs.readDir("");
    setTree(entries.filter(visible).map((e) => ({ ...e, loaded: false, expanded: false })));
  }

  function updateNode(path: string, fn: (n: FsNode) => FsNode): void {
    setTree((prev) => prev.map((n) => mapNode(n, path, fn)));
  }

  async function toggle(node: FsNode): Promise<void> {
    if (!node.isDirectory) return;
    if (node.expanded) {
      updateNode(node.path, (n) => ({ ...n, expanded: false }));
      return;
    }
    const children = node.loaded ? node.children : await loadChildren(node);
    updateNode(node.path, (n) => ({ ...n, expanded: true, loaded: true, children }));
  }

  /** 目录 → 展开/折叠；markdown 文件 → 记录最近打开 + 广播打开事件（App 层会切到 markdown 工作区）。 */
  function onItemClick(node: FsNode): void {
    if (node.isDirectory) {
      void toggle(node);
      return;
    }
    if (!isMarkdownFile(node.name) && !isSessionFile(node.name)) return;
    // lastOpenPath 按实例区分（审查 phase30 第4步）；openFile 定向本实例（第3步）
    kernel.storage.namespace("minex.filesystem").set(`lastOpenPath@${instanceId ?? 0}`, node.path);
    kernel.events.emit("filesystem:openFile", { path: node.path, targetInstanceId: instanceId });
  }

  /** 保存/删除文件后刷新根列表（保留展开状态；已展开子目录的新增文件需重新折叠/展开才可见——v1 简化）。
   *  G-A 反馈 5：订阅 minex:dataChanged——删除会话（.ses 真删）后文件树同步刷新。 */
  useEffect(() => {
    const offs: Array<() => void> = [];
    offs.push(kernel.events.on("filesystem:fileSaved", () => void refreshTree()));
    offs.push(kernel.events.on("minex:dataChanged", () => void refreshTree()));
    return () => offs.forEach((off) => off());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kernel, fs]);

  async function refreshTree(): Promise<void> {
    if (!fs.hasRoot()) return;
    const entries = (await fs.readDir("")).filter(visible);
    setTree((prev) => {
      const prevByPath = new Map(prev.map((r) => [r.path, r]));
      return entries.map((e) => {
        const old = prevByPath.get(e.path);
        return old?.expanded
          ? { ...e, expanded: true, loaded: true, children: old.children }
          : { ...e, loaded: false, expanded: false };
      });
    });
  }

  // 挂载时若已有根目录，仅恢复文件树（readDir("")），不重弹「选择文件夹」对话框；
  // openRoot（showDirectoryPicker 弹窗）只应由用户点「打开文件夹」按钮触发（审查 M1）。
  useEffect(() => {
    if (hasRoot && tree.length === 0) void refreshTree();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="fs-sidebar">
      {!hasRoot ? (
        <button className="btn" onClick={() => void openRoot()}>打开文件夹</button>
      ) : (
        <div className="fs-tree">
          {tree.map((n) => (
            <FsTreeItem key={n.path} node={n} depth={0} onItemClick={onItemClick} />
          ))}
        </div>
      )}
    </div>
  );
}

function mapNode(n: FsNode, path: string, fn: (n: FsNode) => FsNode): FsNode {
  if (n.path === path) return fn(n);
  if (n.children) return { ...n, children: n.children.map((c) => mapNode(c, path, fn)) };
  return n;
}

function FsTreeItem({ node, depth, onItemClick }: { node: FsNode; depth: number; onItemClick: (n: FsNode) => void }) {
  return (
    <>
      <div className="fs-item" style={{ paddingLeft: 8 + depth * 14 }} onClick={() => onItemClick(node)}>
        <span className="fs-icon">{node.isDirectory ? (node.expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />) : fileIcon(node.name)}</span>
        <span>{node.name}</span>
      </div>
      {node.expanded && node.children?.map((c) => <FsTreeItem key={c.path} node={c} depth={depth + 1} onItemClick={onItemClick} />)}
    </>
  );
}

/** 文件类型 → 图标（lucide 开源图标体系；图标色后续接 appearance 主题） */
function fileIcon(name: string): ReactNode {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  const size = 14;
  if (["md", "markdown"].includes(ext)) return <FileText size={size} />;
  if (["ts", "tsx", "js", "jsx", "py", "cpp", "c", "rs", "go"].includes(ext)) return <FileCode size={size} />;
  if (["json", "yaml", "yml", "toml"].includes(ext)) return <FileCog size={size} />;
  if (["png", "jpg", "jpeg", "gif", "svg"].includes(ext)) return <FileImage size={size} />;
  return <File size={size} />;
}
