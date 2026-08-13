import type { MinexKernel } from "@minex/kernel";
import { useMemo, useState } from "react";
import readme from "../README.md?raw";
import { renderMarkdown } from "./markdown.js";

const CODE_FONTS = ["Cascadia Code", "JetBrains Mono", "Consolas", "Courier New", "Fira Code", "Source Code Pro", "Ubuntu Mono", "Menlo", "Monaco"];

/** markdown 编辑器设置：介绍（README）/ 设置（代码块字体）选项卡 */
export default function SettingsView({ kernel }: { kernel: MinexKernel }) {
  const [tab, setTab] = useState<"about" | "settings">("about");
  const [codeFont, setCodeFont] = useState<string>(() => kernel.storage.namespace("minex.markdown").get<string>("codeFont") ?? "");

  const readmeHtml = useMemo(() => renderMarkdown(readme), []);

  function setFont(v: string): void {
    setCodeFont(v);
    kernel.storage.namespace("minex.markdown").set("codeFont", v);
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
          <div className="section-title">编辑器设置</div>
          <div className="field">
            <label>代码块字体</label>
            <div className="field-control">
              <select value={codeFont} onChange={(e) => setFont(e.target.value)}>
                <option value="">默认</option>
                {CODE_FONTS.map((f) => (
                  <option key={f} value={f} style={{ fontFamily: `"${f}"` }}>{f}</option>
                ))}
              </select>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
