import { useEffect, useState } from "react";
import type { MinexKernel } from "@minex/kernel";
import { collectCapabilities } from "../capabilities.js";
import { countDependents } from "../overview.js";
import { DriverIcon } from "./DriverIcon.js";

/**
 * 驱动总览（阶段 A2）：只读表格，替代设置页占位文案。
 * 每行 = 图标 + 名称 + 版本 + 状态（activated/deactivated…）+ 来源 + 标签
 * + 依赖（dependencies + 被依赖计数）+ 能力一览（collectCapabilities 全量输出，不得过滤——
 * 裁决 #1：mist.session 的 session/session.md 必须可见）。
 * 行点击进入 DriverDetail；能力/状态随 registry 变化刷新（订阅模式与 ManageView 一致）。
 */
export function OverviewView({
  kernel,
  onOpenDetail,
}: {
  kernel: MinexKernel;
  onOpenDetail: (driverId: string) => void;
}) {
  const [, setTick] = useState(0);

  useEffect(() => {
    const offs: Array<() => void> = [];
    offs.push(kernel.registry.onChange("*", () => setTick((t) => t + 1)));
    offs.push(kernel.events.on("minex:dataChanged", () => setTick((t) => t + 1)));
    return () => offs.forEach((off) => off());
  }, [kernel]);

  const drivers = kernel.drivers.list();
  const capsById = new Map(collectCapabilities(kernel).map((d) => [d.driverId, d.contributions]));

  if (drivers.length === 0) {
    return <div className="card muted">暂无已加载驱动</div>;
  }

  return (
    <table className="manage-table">
      <thead>
        <tr>
          <th>驱动</th>
          <th>版本</th>
          <th>状态</th>
          <th>来源</th>
          <th>标签</th>
          <th>依赖</th>
          <th>能力</th>
        </tr>
      </thead>
      <tbody>
        {drivers.map((d) => {
          const m = d.manifest;
          const state = kernel.drivers.getState(m.id);
          const deps = m.dependencies ?? [];
          const dependents = countDependents(drivers, m.id);
          const caps = capsById.get(m.id) ?? [];
          return (
            <tr key={m.id} className="overview-row" onClick={() => onOpenDetail(m.id)}>
              <td>
                <span className="row-name">
                  <DriverIcon icon={m.icon} />
                  <span>{m.name}</span>
                  <span className="muted">{m.id}</span>
                </span>
              </td>
              <td>{m.version}</td>
              <td>
                <span className={`state-badge state-${state ?? "unknown"}`}>{state ?? "-"}</span>
              </td>
              <td>{m.source ?? "本地"}</td>
              <td>
                {m.tags && m.tags.length > 0 ? (
                  <span className="driver-tags" style={{ marginTop: 0 }}>
                    {m.tags.map((t) => (
                      <span key={t} className="driver-tag">
                        {t}
                      </span>
                    ))}
                  </span>
                ) : (
                  <span className="muted">-</span>
                )}
              </td>
              <td>
                {deps.length === 0 ? <span className="muted">-</span> : deps.join(", ")}
                <span className="muted overview-dependents">被 {dependents} 个依赖</span>
              </td>
              <td>
                {caps.length === 0 ? (
                  <span className="muted">无</span>
                ) : (
                  <span className="overview-caps">
                    {caps.map((c) => (
                      <span key={`${c.type}/${c.id}`} className="cap-badge" title={`${c.type}/${c.id} · ${c.origin}`}>
                        {c.type}
                      </span>
                    ))}
                  </span>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
