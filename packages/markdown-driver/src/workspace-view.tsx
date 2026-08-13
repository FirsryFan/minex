import type { MinexKernel } from "@minex/kernel";
import { useEffect, useMemo, useState } from "react";
import "highlight.js/styles/github.css";
import "katex/dist/katex.min.css";
import { renderMarkdown, type RenderOptions } from "./markdown.js";

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

## 数学公式

行内公式 $E = mc^2$ 与块级公式：

$$
\\int_{-\\infty}^{\\infty} e^{-x^2} dx = \\sqrt{\\pi}
$$

## 列表

1. 编辑 markdown
2. 实时预览
3. 切换模式

> 这是引用块。
`;

const DOC_KEY = "doc";

/** markdown 编辑器工作区：编辑 / 预览 / 分屏三模式（渲染选项读驱动设置） */
export default function WorkspaceView({ kernel }: { kernel: MinexKernel }) {
  const [mode, setMode] = useState<Mode>("split");
  const [doc, setDoc] = useState<string>(() => kernel.storage.namespace("minex.markdown").get<string>(DOC_KEY) ?? DEFAULT_DOC);
  const [renderOpts, setRenderOpts] = useState<RenderOptions>(() => readRenderOpts(kernel));

  // 设置变化 → 重新读渲染选项
  useEffect(() => {
    const off = kernel.events.on("minex:dataChanged", () => setRenderOpts(readRenderOpts(kernel)));
    return off;
  }, [kernel]);

  function updateDoc(text: string): void {
    setDoc(text);
    kernel.storage.namespace("minex.markdown").set(DOC_KEY, text);
  }

  const html = useMemo(() => renderMarkdown(doc, renderOpts), [doc, renderOpts]);

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

function readRenderOpts(kernel: MinexKernel): RenderOptions {
  const ns = kernel.storage.namespace("minex.markdown");
  return {
    codeHighlight: ns.get<boolean>("codeHighlight") ?? false,
    katex: ns.get<boolean>("katex") ?? false,
  };
}
