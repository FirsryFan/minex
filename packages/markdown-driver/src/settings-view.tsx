import type { MinexKernel } from "@minex/kernel";
import { useState } from "react";

const CODE_FONTS = ["Cascadia Code", "JetBrains Mono", "Consolas", "Courier New", "Fira Code", "Source Code Pro", "Ubuntu Mono", "Menlo", "Monaco"];

/** markdown 编辑器设置（v1：代码块字体；后续接 appearance「驱动设置」扩展点） */
export default function SettingsView({ kernel }: { kernel: MinexKernel }) {
  const [codeFont, setCodeFont] = useState<string>(() => kernel.storage.namespace("minex.markdown").get<string>("codeFont") ?? "");

  function setFont(v: string): void {
    setCodeFont(v);
    kernel.storage.namespace("minex.markdown").set("codeFont", v);
    kernel.events.emit("minex:dataChanged", { driverId: "minex.markdown" });
  }

  return (
    <div className="card">
      <div className="section-title">编辑器设置</div>
      <div className="field">
        <label>代码块字体</label>
        <div className="field-control">
          <select value={codeFont} onChange={(e) => setFont(e.target.value)}>
            <option value="">（默认）</option>
            {CODE_FONTS.map((f) => (
              <option key={f} value={f} style={{ fontFamily: `"${f}"` }}>{f}</option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
}
