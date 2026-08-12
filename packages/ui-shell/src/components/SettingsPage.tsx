import { useEffect, useState } from "react";
import type { MinexKernel } from "@minex/kernel";
import { useKernel } from "../kernel-context.js";
import { DriverDetail } from "./DriverDetail.js";
import { DriverIcon } from "./DriverIcon.js";

type Section = "download" | "manage" | "overview";

/**
 * 主设置页：全屏大界面（无顶栏）。左栏文件夹式导航，主体为对应设置。
 * v1：驱动管理（搜索 + 表格 + 启用/禁用）；下载/总览为占位。
 */
export function SettingsPage({ onBack }: { onBack: () => void }) {
  const kernel = useKernel();
  const [folderOpen, setFolderOpen] = useState(true);
  const [section, setSection] = useState<Section>("manage");
  const [search, setSearch] = useState("");
  const [selectedDriverId, setSelectedDriverId] = useState<string | null>(null);
  const [, setTick] = useState(0);

  // 注册表/数据变化 → 重渲染（启用开关状态同步）
  useEffect(() => {
    const offs: Array<() => void> = [];
    offs.push(kernel.registry.onChange("*", () => setTick((t) => t + 1)));
    offs.push(kernel.events.on("minex:dataChanged", () => setTick((t) => t + 1)));
    return () => offs.forEach((off) => off());
  }, [kernel]);

  return (
    <div className="settings-page">
      <nav className="settings-nav">
        <div className="settings-nav-head">
          <button className="icon-btn" onClick={onBack}>
            ← 返回
          </button>
          <strong>设置</strong>
        </div>
        <div className="folder-head" onClick={() => setFolderOpen((o) => !o)}>
          {folderOpen ? "▾" : "▸"} 驱动设置
        </div>
        {folderOpen && (
          <div className="folder-children">
            <div className={`folder-item${section === "download" ? " active" : ""}`} onClick={() => setSection("download")}>
              驱动下载
            </div>
            <div className={`folder-item${section === "manage" ? " active" : ""}`} onClick={() => setSection("manage")}>
              驱动管理
            </div>
            <div className={`folder-item${section === "overview" ? " active" : ""}`} onClick={() => setSection("overview")}>
              驱动总览
            </div>
          </div>
        )}
      </nav>

      <div className="settings-main">
        {selectedDriverId ? (
          <DriverDetail
            kernel={kernel}
            driverId={selectedDriverId}
            onBack={() => setSelectedDriverId(null)}
          />
        ) : section === "manage" ? (
          <ManageView kernel={kernel} search={search} onSearch={setSearch} onOpenDetail={setSelectedDriverId} />
        ) : section === "download" ? (
          <div className="card muted">驱动下载（暂未实现，留待后续）</div>
        ) : (
          <div className="card muted">驱动总览（暂未实现，留待后续）</div>
        )}
      </div>
    </div>
  );
}

function ManageView({
  kernel,
  search,
  onSearch,
  onOpenDetail,
}: {
  kernel: MinexKernel;
  search: string;
  onSearch: (s: string) => void;
  onOpenDetail: (id: string) => void;
}) {
  const drivers = kernel.drivers.list();
  const q = search.trim().toLowerCase();
  const filtered = q
    ? drivers.filter(
        (d) => d.manifest.name.toLowerCase().includes(q) || d.manifest.id.toLowerCase().includes(q),
      )
    : drivers;

  // D1：deactivated 态必须走 reload（activate 对 deactivated 抛错）；单个 toggle 容错。
  async function setDriverState(id: string, enabled: boolean): Promise<void> {
    const state = kernel.drivers.getState(id);
    try {
      if (enabled) {
        if (state === "activated") return;
        if (state === "deactivated") await kernel.drivers.reload(id);
        else await kernel.drivers.activate(id);
      } else {
        if (state === "activated") await kernel.drivers.deactivate(id);
      }
    } catch (err) {
      console.error(`驱动状态切换失败 ${id}:`, err);
    }
  }

  async function toggle(id: string): Promise<void> {
    const enabled = kernel.drivers.getState(id) === "activated";
    await setDriverState(id, !enabled);
  }

  async function setAll(enabled: boolean): Promise<void> {
    for (const d of kernel.drivers.list()) {
      await setDriverState(d.manifest.id, enabled); // 内部已逐驱动容错
    }
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
        <button className="btn-ghost" onClick={() => void setAll(true)}>
          全部启用
        </button>
        <button className="btn-ghost" onClick={() => void setAll(false)}>
          全部禁用
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
            return (
              <tr key={d.manifest.id}>
                <td>
                  <span className="row-name">
                    <DriverIcon icon={d.manifest.icon} />
                    <span>{d.manifest.name}</span>
                    <span className="muted">v{d.manifest.version}</span>
                    <span className="muted">{enabled ? "● 已启用" : "○ 已禁用"}</span>
                  </span>
                </td>
                <td style={{ textAlign: "right" }}>
                  <button className="icon-btn" onClick={() => void toggle(d.manifest.id)}>
                    {enabled ? "禁用" : "启用"}
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
    </div>
  );
}
