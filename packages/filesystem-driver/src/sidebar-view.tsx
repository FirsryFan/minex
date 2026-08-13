import type { MinexKernel } from "@minex/kernel";
import { useCallback, useEffect, useState } from "react";
import type { FileSystemAbility, FsEntry } from "./fs.js";

interface FsNode extends FsEntry {
  children?: FsNode[];
  loaded?: boolean;
  expanded?: boolean;
}

/** 文件系统侧边栏：打开文件夹 → 以根展开的文件树 */
export default function SidebarView({ kernel }: { kernel: MinexKernel }) {
  const [fs] = useState<FileSystemAbility>(() => kernel.registry.get<FileSystemAbility>("filesystem", "default")!.value);
  const [hasRoot, setHasRoot] = useState(fs.hasRoot());
  const [tree, setTree] = useState<FsNode[]>([]);

  const loadChildren = useCallback(
    async (node: FsNode): Promise<FsNode[]> => {
      const entries = await fs.readDir(node.path);
      return entries.map((e) => ({ ...e, loaded: false, expanded: false }));
    },
    [fs],
  );

  async function openRoot(): Promise<void> {
    await fs.openRoot();
    setHasRoot(true);
    const entries = await fs.readDir("");
    setTree(entries.map((e) => ({ ...e, loaded: false, expanded: false })));
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

  useEffect(() => {
    if (hasRoot && tree.length === 0) void openRoot();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="fs-sidebar">
      {!hasRoot ? (
        <button className="btn" onClick={() => void openRoot()}>打开文件夹</button>
      ) : (
        <div className="fs-tree">
          {tree.map((n) => (
            <FsTreeItem key={n.path} node={n} depth={0} onToggle={toggle} />
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

function FsTreeItem({ node, depth, onToggle }: { node: FsNode; depth: number; onToggle: (n: FsNode) => void }) {
  return (
    <>
      <div className="fs-item" style={{ paddingLeft: 8 + depth * 14 }} onClick={() => void onToggle(node)}>
        <span className="fs-icon">{node.isDirectory ? (node.expanded ? "▾" : "▸") : iconFor(node.name)}</span>
        <span>{node.name}</span>
      </div>
      {node.expanded && node.children?.map((c) => <FsTreeItem key={c.path} node={c} depth={depth + 1} onToggle={onToggle} />)}
    </>
  );
}

/** 文件类型 → emoji 图标（v1 简化；图标体系后续接 appearance） */
function iconFor(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (["md", "markdown"].includes(ext)) return "📝";
  if (["ts", "tsx", "js", "jsx", "py", "cpp", "c", "rs", "go"].includes(ext)) return "🧾";
  if (["json", "yaml", "yml", "toml"].includes(ext)) return "⚙️";
  if (["png", "jpg", "jpeg", "gif", "svg"].includes(ext)) return "🖼";
  return "📄";
}
