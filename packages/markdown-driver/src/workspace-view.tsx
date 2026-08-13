import type { MinexKernel } from "@minex/kernel";
import { useMemo, useState } from "react";
import { renderMarkdown } from "./markdown.js";

type Mode = "edit" | "preview" | "split";

const DEFAULT_DOC = `# 欢迎使用 Minex Markdown 编辑器

这是第一个有工作区的驱动。支持 **三种模式**：

- 纯编辑
- 纯预览
- 分屏

## 代码块

\`\`\`ts
function hello(name: string): string {
  return \`Hello, \${name}!\`;
}
\`\`\`

## 列表

1. 编辑 markdown
2. 实时预览
3. 切换模式

> 这是引用块。
`;

const DOC_KEY = "doc";

/** markdown 编辑器工作区：编辑 / 预览 / 分屏三模式 */
export default function WorkspaceView({ kernel }: { kernel: MinexKernel }) {
  const [mode, setMode] = useState<Mode>("split");
  const [doc, setDoc] = useState<string>(() => kernel.storage.namespace("minex.markdown").get<string>(DOC_KEY) ?? DEFAULT_DOC);

  function updateDoc(text: string): void {
    setDoc(text);
    kernel.storage.namespace("minex.markdown").set(DOC_KEY, text);
  }

  const html = useMemo(() => renderMarkdown(doc), [doc]);

  return (
    <div className="md-workspace">
      <div className="md-toolbar">
        <button className={`md-mode${mode === "edit" ? " active" : ""}`} onClick={() => setMode("edit")}>编辑</button>
        <button className={`md-mode${mode === "preview" ? " active" : ""}`} onClick={() => setMode("preview")}>预览</button>
        <button className={`md-mode${mode === "split" ? " active" : ""}`} onClick={() => setMode("split")}>分屏</button>
      </div>
      <div className="md-body">
        {mode !== "preview" && (
          <textarea
            className="md-editor"
            value={doc}
            onChange={(e) => updateDoc(e.target.value)}
            spellCheck={false}
          />
        )}
        {mode !== "edit" && (
          <div className="md-preview markdown-body" dangerouslySetInnerHTML={{ __html: html }} />
        )}
      </div>
    </div>
  );
}
