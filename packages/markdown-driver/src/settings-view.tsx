import type { MinexKernel } from "@minex/kernel";
import { useMemo, useState } from "react";
import readme from "../README.md?raw";
import { renderMarkdown } from "./markdown.js";

const CODE_FONTS = ["Cascadia Code", "JetBrains Mono", "Consolas", "Courier New", "Fira Code", "Source Code Pro", "Ubuntu Mono", "Menlo", "Monaco"];
const EN_FONTS = ["Arial", "Georgia", "Times New Roman", "Verdana", "Tahoma", "Trebuchet MS", "Segoe UI", "Roboto", "Open Sans"];
const ZH_FONTS = ["PingFang SC", "Microsoft YaHei", "SimHei", "SimSun", "Songti SC", "KaiTi", "FangSong", "Noto Sans CJK SC"];

/** markdown 编辑器设置：介绍（README）/ 设置（文档字体/缩放/代码块）选项卡 */
export default function SettingsView({ kernel }: { kernel: MinexKernel }) {
  const [tab, setTab] = useState<"about" | "settings">("about");
  const ns = kernel.storage.namespace("minex.markdown");
  const [values, setValues] = useState<Record<string, string | number | boolean>>(() => ({
    docEnFont: ns.get<string>("docEnFont") ?? "",
    docZhFont: ns.get<string>("docZhFont") ?? "",
    fontSize: ns.get<number>("fontSize") ?? 14,
    codeFont: ns.get<string>("codeFont") ?? "",
    codeWrap: ns.get<boolean>("codeWrap") ?? false,
  }));

  const readmeHtml = useMemo(() => renderMarkdown(readme), []);

  function setField(key: string, value: string | number | boolean): void {
    setValues((prev) => ({ ...prev, [key]: value }));
    ns.set(key, value as never);
    kernel.events.emit("minex:dataChanged", { driverId: "minex.markdown" });
  }

  return (
    <div>
      <div className="detail-tabs">
        <button className={`detail-tab${tab === "about" ? " active" : ""}`} onClick={() => setTab("about")}>
          介绍
        </button>
        <button className={`detail-tab${tab === "settings" ? " active" : ""}`} onClick={() => setTab("settings")}>
          设置
        </button>
      </div>

      {tab === "about" ? (
        <div className="card readme-card markdown-body" dangerouslySetInnerHTML={{ __html: readmeHtml }} />
      ) : (
        <div className="card">
          <div className="section-title">文档字体</div>
          <FontRow label="英文" fonts={EN_FONTS} value={String(values.docEnFont)} onChange={(v) => setField("docEnFont", v)} />
          <FontRow label="中文" fonts={ZH_FONTS} value={String(values.docZhFont)} onChange={(v) => setField("docZhFont", v)} />

          <div className="section-title">缩放</div>
          <div className="field">
            <label>字号</label>
            <div className="field-control">
              <input type="number" min={10} max={32} value={Number(values.fontSize)} onChange={(e) => setField("fontSize", Number(e.target.value) || 14)} />
            </div>
          </div>

          <div className="section-title">代码块</div>
          <FontRow label="代码块字体" fonts={CODE_FONTS} value={String(values.codeFont)} onChange={(v) => setField("codeFont", v)} />
          <div className="field">
            <label>自动换行</label>
            <div className="field-control">
              <input type="checkbox" checked={Boolean(values.codeWrap)} onChange={(e) => setField("codeWrap", e.target.checked)} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function FontRow({ label, fonts, value, onChange }: { label: string; fonts: string[]; value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="field">
      <label>{label}</label>
      <div className="field-control">
        <div className="driver-selector">
          <button className="select-btn" onClick={() => setOpen((o) => !o)}>
            <span style={{ fontFamily: value ? `"${value}"` : undefined }}>{value}</span>
          </button>
          {open && (
            <div className="dropdown">
              <div className="dropdown-list">
                {fonts.map((f) => (
                  <div key={f} className="dropdown-item" onClick={() => { onChange(f); setOpen(false); }}>
                    <span style={{ fontFamily: `"${f}"` }}>{f}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
