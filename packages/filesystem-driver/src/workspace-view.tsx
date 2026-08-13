import type { MinexKernel } from "@minex/kernel";
import type { FileSystemAbility } from "./fs.js";

/** 文件系统工作区：显示当前根目录状态（v1 占位，文件打开/编辑由 markdown 等驱动消费 filesystem 能力） */
export default function WorkspaceView({ kernel }: { kernel: MinexKernel }) {
  const fs = kernel.registry.get<FileSystemAbility>("filesystem", "default")?.value;

  return (
    <div className="fs-workspace">
      {fs?.hasRoot() ? (
        <div className="card muted">已打开文件夹。文件树在左侧栏；文件打开/编辑由 markdown 等驱动消费 filesystem 能力。</div>
      ) : (
        <div className="card muted">尚未打开文件夹。点击左侧栏「打开文件夹」选择根目录。</div>
      )}
    </div>
  );
}
