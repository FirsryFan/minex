import { useEffect, useState } from "react";
import type { MinexKernel } from "@minex/kernel";
import { deleteWorkflow, loadWorkflows, saveWorkflow } from "./workflow-store.js";
import type { Workflow } from "./workflow.js";

/**
 * Workflow 列表面板（W-C，agent 左栏「工作流」，仅 agent 驱动显示）：
 * 列表（id + 节点数 + op 摘要）+ 新建/删除（确认）；单击条目 → emit `minex:editWorkflow { id, targetInstanceId }`
 * → 主区大型 canvas 编辑器。
 */
export default function WorkflowListView({ kernel, instanceId }: { kernel: MinexKernel; instanceId?: number }) {
  const [workflows, setWorkflows] = useState<Record<string, Workflow>>(() => loadWorkflows(kernel));
  const [confirmDel, setConfirmDel] = useState<string | null>(null);

  useEffect(() => {
    return kernel.events.on("minex:dataChanged", () => setWorkflows(loadWorkflows(kernel)));
  }, [kernel]);

  const list = Object.entries(workflows);

  function createNew(): void {
    const id = `wf-${Date.now()}`;
    saveWorkflow(kernel, id, {
      nodes: [{ id: "n1", op: "localVar", args: { op: "set", key: "v", value: "hello" } }],
    });
    setWorkflows(loadWorkflows(kernel));
    kernel.events.emit("minex:dataChanged", { driverId: "minex.agent" });
  }

  function doDelete(id: string): void {
    deleteWorkflow(kernel, id);
    setWorkflows(loadWorkflows(kernel));
    setConfirmDel(null);
    kernel.events.emit("minex:dataChanged", { driverId: "minex.agent" });
  }

  function openEditor(id: string): void {
    kernel.events.emit("minex:editWorkflow", { id, targetInstanceId: instanceId });
  }

  return (
    <div className="workflow-list">
      <div className="workflow-list-head">
        <span className="muted">Workflows</span>
        <button className="btn-ghost" title="新建 workflow" onClick={createNew}>＋</button>
      </div>
      {list.length === 0 && <div className="muted">暂无 workflow，点 ＋ 新建</div>}
      {list.map(([id, w]) => (
        <div key={id} className="workflow-item" onClick={() => openEditor(id)} title="单击进入编辑器">
          <div className="workflow-item-id">{id}</div>
          <div className="muted workflow-item-summary">
            {w.nodes.length} 节点 · {w.nodes.map((n) => n.op).join(", ")}
          </div>
          <button
            className="agent-list-del"
            title="删除 workflow"
            onClick={(e) => {
              e.stopPropagation();
              setConfirmDel(id);
            }}
          >
            ×
          </button>
        </div>
      ))}

      {confirmDel && (
        <div className="floating-mask" onClick={() => setConfirmDel(null)}>
          <div className="confirm-box" onClick={(e) => e.stopPropagation()}>
            <p>确定删除 workflow「{confirmDel}」？此操作不可撤销。</p>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 12 }}>
              <button className="btn-ghost" onClick={() => setConfirmDel(null)}>取消</button>
              <button className="btn" onClick={() => doDelete(confirmDel)}>删除</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
