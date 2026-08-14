import { useEffect, useState } from "react";
import type { MinexKernel } from "@minex/kernel";
import { useKernel } from "../kernel-context.js";
import { planApply } from "../plan-apply.js";
import { DriverDetail } from "./DriverDetail.js";
import { DriverIcon } from "./DriverIcon.js";
import { LeftNavLayout } from "./LeftNavLayout.js";
import { OverviewView } from "./OverviewView.js";

type Section = "download" | "manage" | "overview";

/**
 * 主设置页：全屏大界面（无顶栏）。F6 反馈 6：左栏改为可复用 LeftNavLayout（固定、不可拆卸、
 * 不显示面板 tab / 拆放入口）；驱动详情 = 独立全屏页（LeftNavLayout 第二消费方）。
 * v1：驱动管理（暂存式启用/禁用 + 依赖警告）；下载/总览为占位。
 */
export function SettingsPage({ onBack }: { onBack: () => void }) {
  const kernel = useKernel();
  const [folderOpen, setFolderOpen] = useState(true);
  const [section, setSection] = useState<Section>("manage");
  const [search, setSearch] = useState("");
  const [selectedDriverId, setSelectedDriverId] = useState<string | null>(null);
  const [, setTick] = useState(0);

  useEffect(() => {
    const offs: Array<() => void> = [];
    offs.push(kernel.registry.onChange("*", () => setTick((t) => t + 1)));
    offs.push(kernel.events.on("minex:dataChanged", () => setTick((t) => t + 1)));
    return () => offs.forEach((off) => off());
  }, [kernel]);

  // F6：驱动详情 = 独立全屏页（左栏 = 返回 + 驱动名，主体 = settingsView；左栏固定无拆放入口）
  if (selectedDriverId) {
    const driver = kernel.drivers.list().find((d) => d.manifest.id === selectedDriverId);
    return (
      <LeftNavLayout
        title={driver?.manifest.name ?? "驱动"}
        onBack={() => setSelectedDriverId(null)}
        main={
          <DriverDetail
            kernel={kernel}
            driverId={selectedDriverId}
            onBack={() => setSelectedDriverId(null)}
          />
        }
      />
    );
  }

  return (
    <LeftNavLayout
      title="设置"
      onBack={onBack}
      width={220} // 沿用原 .settings-page 左栏宽，外观不变
      nav={
        <nav className="settings-nav">
          <div className="folder-head" onClick={() => setFolderOpen((o) => !o)}>
            {folderOpen ? "▾" : "▸"} 驱动设置
          </div>
          {folderOpen && (
            <div className="folder-children">
              {/* 点左栏导航 → 切区（详情页已独立返回，无需再退详情） */}
              <div
                className={`folder-item${section === "download" ? " active" : ""}`}
                onClick={() => setSection("download")}
              >
                驱动下载
              </div>
              <div
                className={`folder-item${section === "manage" ? " active" : ""}`}
                onClick={() => setSection("manage")}
              >
                驱动管理
              </div>
              <div
                className={`folder-item${section === "overview" ? " active" : ""}`}
                onClick={() => setSection("overview")}
              >
                驱动总览
              </div>
            </div>
          )}
        </nav>
      }
      main={
        <div className="settings-main">
          {section === "manage" ? (
            <ManageView
              kernel={kernel}
              search={search}
              onSearch={setSearch}
              onOpenDetail={setSelectedDriverId}
              onApplied={() => setTick((t) => t + 1)}
            />
          ) : section === "download" ? (
            <div className="card muted">驱动下载（暂未实现，留待后续）</div>
          ) : (
            <OverviewView kernel={kernel} onOpenDetail={setSelectedDriverId} />
          )}
        </div>
      }
    />
  );
}

/**
 * 驱动管理（暂存式）：
 * 点击启用/禁用只「标记待变更」（不立即生效），点「重新加载」统一应用。
 * 禁用被其他已激活驱动依赖的驱动时弹警告。
 */
function ManageView({
  kernel,
  search,
  onSearch,
  onOpenDetail,
  onApplied,
}: {
  kernel: MinexKernel;
  search: string;
  onSearch: (s: string) => void;
  onOpenDetail: (id: string) => void;
  onApplied: () => void;
}) {
  // pending: driverId → 期望的启用状态（true=启用，false=禁用）；undefined=无待变更
  const [pending, setPending] = useState<Record<string, boolean>>({});
  // confirm: 依赖警告确认（pending = 确认后要合并的待变更；message = 警告文案；onConfirm = 确认后的继续动作）
  const [confirm, setConfirm] = useState<{
    pending: Record<string, boolean>;
    message: string;
    onConfirm?: () => void;
  } | null>(null);
  const [, setTick] = useState(0);

  useEffect(() => {
    const offs: Array<() => void> = [];
    offs.push(kernel.registry.onChange("*", () => setTick((t) => t + 1)));
    offs.push(kernel.events.on("minex:dataChanged", () => setTick((t) => t + 1)));
    return () => offs.forEach((off) => off());
  }, [kernel]);

  const drivers = kernel.drivers.list();
  const q = search.trim().toLowerCase();
  const filtered = q
    ? drivers.filter(
        (d) => d.manifest.name.toLowerCase().includes(q) || d.manifest.id.toLowerCase().includes(q),
      )
    : drivers;

  const pendingCount = Object.keys(pending).length;

  /** 直接依赖 driverId 的驱动：已激活 OR 待启用（S4：含传递警告的场景按直接依赖，含 pending） */
  function dependents(driverId: string): string[] {
    return kernel.drivers
      .list()
      .filter(
        (d) =>
          d.manifest.dependencies?.includes(driverId) &&
          (kernel.drivers.getState(d.manifest.id) === "activated" || pending[d.manifest.id] === true),
      )
      .map((d) => d.manifest.id);
  }

  /** 标记待变更。禁用方向且被依赖 → 弹警告确认。 */
  function mark(id: string, enabled: boolean): void {
    if (!enabled) {
      const deps = dependents(id);
      if (deps.length > 0) {
        setConfirm({
          pending: { [id]: false },
          message: `驱动 "${id}" 被 ${deps.length} 个驱动依赖（${deps.join("、")}），确定禁用？`,
        });
        return;
      }
    }
    setPending((p) => ({ ...p, [id]: enabled }));
  }

  function confirmApply(): void {
    if (confirm) {
      setPending((p) => ({ ...p, ...confirm.pending }));
      confirm.onConfirm?.(); // 冲突场景：确认后继续执行计划
    }
    setConfirm(null);
  }

  /** 点击切换：有 pending 则撤销；否则标记当前状态的相反 */
  function toggle(id: string): void {
    if (pending[id] !== undefined) {
      setPending((p) => {
        const next = { ...p };
        delete next[id];
        return next;
      });
      return;
    }
    const current = kernel.drivers.getState(id) === "activated";
    mark(id, !current);
  }

  /** S2：全部禁用涉及被依赖驱动 → 弹确认 */
  function setAll(enabled: boolean): void {
    const next: Record<string, boolean> = { ...pending };
    for (const d of kernel.drivers.list()) next[d.manifest.id] = enabled;
    if (!enabled) {
      const affected = kernel.drivers.list().filter((d) => dependents(d.manifest.id).length > 0);
      if (affected.length > 0) {
        setConfirm({
          pending: next,
          message: `「全部禁用」涉及 ${affected.length} 个被依赖驱动（${affected
            .map((d) => d.manifest.id)
            .join("、")}），确定？`,
        });
        return;
      }
    }
    setPending(next);
  }

  /** S1+W1：按 planApply 计划应用（冲突弹确认）；失败项保留并汇报 */
  async function applyAll(): Promise<void> {
    const plan = planApply(
      pending,
      (id) => kernel.drivers.list().find((d) => d.manifest.id === id)?.manifest.dependencies ?? [],
    );
    if (plan.conflicts.length > 0) {
      setConfirm({
        pending,
        message: `检测到依赖冲突：\n${plan.conflicts.join("\n")}\n\n继续执行可能导致依赖不一致（启用项会连带激活其被禁依赖）。`,
        onConfirm: () => void executePlan(plan.steps), // W1：确认后按计划执行
      });
      return;
    }
    await executePlan(plan.steps);
  }

  /** 按步骤应用并保留失败项 */
  async function executePlan(steps: { id: string; enabled: boolean }[]): Promise<void> {
    const failures: string[] = [];
    for (const s of steps) {
      if (!(await applyDriverState(kernel, s.id, s.enabled))) failures.push(s.id);
    }
    const failedSet = new Set(failures);
    const remaining: Record<string, boolean> = {};
    for (const [id, e] of Object.entries(pending)) if (failedSet.has(id)) remaining[id] = e;
    setPending(remaining);
    if (failures.length > 0) console.error(`驱动状态应用失败：${failures.join(", ")}`);
    onApplied();
  }

  return (
    <div>
      <div className="manage-toolbar">
        <input
          className="manage-search"
          placeholder="搜索驱动…"
          value={search}
          onChange={(e) => onSearch(e.target.value)}
        />
        <button className="btn-ghost" onClick={() => setAll(true)}>
          全部启用
        </button>
        <button className="btn-ghost" onClick={() => setAll(false)}>
          全部禁用
        </button>
        <button className="btn" onClick={() => void applyAll()} disabled={pendingCount === 0}>
          重新加载{pendingCount > 0 ? `（${pendingCount}）` : ""}
        </button>
      </div>

      <table className="manage-table">
        <thead>
          <tr>
            <th>驱动</th>
            <th style={{ textAlign: "right" }}>操作</th>
          </tr>
        </thead>
        <tbody>
          {filtered.length === 0 && (
            <tr>
              <td colSpan={2} className="muted">
                （无匹配驱动）
              </td>
            </tr>
          )}
          {filtered.map((d) => {
            const enabled = kernel.drivers.getState(d.manifest.id) === "activated";
            const target = pending[d.manifest.id];
            const pendingLabel =
              target !== undefined ? (target ? "待启用" : "待禁用") : null;
            const actionLabel = pendingLabel ?? (enabled ? "禁用" : "启用");
            return (
              <tr key={d.manifest.id}>
                <td>
                  <span className="row-name">
                    <DriverIcon icon={d.manifest.icon} />
                    <span>{d.manifest.name}</span>
                    <span className="muted">v{d.manifest.version}</span>
                    <span className="muted">{enabled ? "● 已启用" : "○ 已禁用"}</span>
                    {pendingLabel && <span className="pending-badge unfinished">{pendingLabel}</span>}
                  </span>
                </td>
                <td style={{ textAlign: "right" }}>
                  <button
                    className={`icon-btn${pendingLabel ? " btn-primary" : ""}`}
                    onClick={() => toggle(d.manifest.id)}
                  >
                    {actionLabel}
                  </button>
                  <button className="icon-btn" title="驱动设置" onClick={() => onOpenDetail(d.manifest.id)}>
                    …
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {confirm && (
        <ConfirmModal
          message={confirm.message}
          onConfirm={confirmApply}
          onCancel={() => setConfirm(null)}
        />
      )}
    </div>
  );
}

function ConfirmModal({
  message,
  onConfirm,
  onCancel,
}: {
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="floating-mask" onClick={onCancel}>
      <div className="confirm-box" onClick={(e) => e.stopPropagation()}>
        <p>{message}</p>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 12 }}>
          <button className="btn-ghost" onClick={onCancel}>
            取消
          </button>
          <button className="btn" onClick={onConfirm}>
            确定禁用
          </button>
        </div>
      </div>
    </div>
  );
}

/** 对称应用驱动状态：启用（deactivated→reload）与禁用统一，逐驱动容错。返回是否成功。 */
async function applyDriverState(kernel: MinexKernel, id: string, enabled: boolean): Promise<boolean> {
  const state = kernel.drivers.getState(id);
  try {
    if (enabled) {
      if (state === "activated") return true;
      if (state === "deactivated") await kernel.drivers.reload(id);
      else await kernel.drivers.activate(id);
    } else {
      if (state === "activated") await kernel.drivers.deactivate(id);
    }
    return true;
  } catch (err) {
    console.error(`应用驱动状态失败 ${id}:`, err);
    return false;
  }
}
