import type { MinexKernel } from "@minex/kernel";

/**
 * 文件系统工作区：主体留空。
 * 文件树常驻左侧栏，打开/编辑由 markdown 等驱动消费 filesystem 能力；
 * 此工作区无自身内容，不显示占位文字。
 */
export default function WorkspaceView({ kernel }: { kernel: MinexKernel }) {
  void kernel; // props 签名保持（外壳统一传 kernel）
  return <div className="fs-workspace" />;
}
