import type { MinexKernel } from "@minex/kernel";
import { useEffect, useMemo, useRef, useState } from "react";
import "highlight.js/styles/github.css";
import "katex/dist/katex.min.css";
import TurndownService from "turndown";
import { renderMarkdown, type RenderOptions } from "./markdown.js";
import { applyFormat, shortcutToAction } from "./shortcuts.js";

type Mode = "edit" | "preview" | "split" | "wysiwyg";

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

> 这是引用块。
`;

const DOC_KEY = "doc";
const turndown = new TurndownService();

/** markdown 编辑器工作区：编辑 / 预览 / 分屏 / 即时（所见即所得）四模式 */
export default function WorkspaceView({ kernel }: { kernel: MinexKernel }) {
  const [mode, setMode] = useState<Mode>("split");
  const [doc, setDoc] = useState<string>(() => kernel.storage.namespace("minex.markdown").get<string>(DOC_KEY) ?? DEFAULT_DOC);
  const [renderOpts, setRenderOpts] = useState<RenderOptions>(() => readRenderOpts(kernel));
  const wysiwygRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const off = kernel.events.on("minex:dataChanged", () => setRenderOpts(readRenderOpts(kernel)));
    return off;
  }, [kernel]);

  // 进入即时模式时，把渲染结果写入 contentEditable（仅进入时同步，避免编辑中光标重置）
  useEffect(() => {
    if (mode === "wysiwyg" && wysiwygRef.current) {
      wysiwygRef.current.innerHTML = renderMarkdown(doc, renderOpts);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  function updateDoc(text: string): void {
    setDoc(text);
    kernel.storage.namespace("minex.markdown").set(DOC_KEY, text);
  }

  const html = useMemo(() => renderMarkdown(doc, renderOpts), [doc, renderOpts]);

  // 源码编辑区快捷键（Typora 风格）
  function onEditorKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>): void {
    const action = shortcutToAction({ ctrlKey: e.ctrlKey, metaKey: e.metaKey, shiftKey: e.shiftKey, key: e.key });
    if (!action) return;
    e.preventDefault();
    const el = e.currentTarget;
    const r = applyFormat(doc, el.selectionStart, el.selectionEnd, action);
    updateDoc(r.text);
    requestAnimationFrame(() => {
      el.selectionStart = r.selectionStart;
      el.selectionEnd = r.selectionEnd;
    });
  }

  // 即时模式：编辑渲染结果 → turndown 转回 markdown 存源码
  function onWysiwygInput(): void {
    if (wysiwygRef.current) {
      const md = turndown.turndown(wysiwygRef.current.innerHTML);
      setDoc(md);
      kernel.storage.namespace("minex.markdown").set(DOC_KEY, md);
    }
  }

  return (
    <div className="md-workspace">
      <div className="md-toolbar">
        <button className={`md-mode${mode === "edit" ? " active" : ""}`} onClick={() => setMode("edit")}>编辑</button>
        <button className={`md-mode${mode === "preview" ? " active" : ""}`} onClick={() => setMode("preview")}>预览</button>
        <button className={`md-mode${mode === "split" ? " active" : ""}`} onClick={() => setMode("split")}>分屏</button>
        <button className={`md-mode${mode === "wysiwyg" ? " active" : ""}`} onClick={() => setMode("wysiwyg")}>即时</button>
      </div>
      <div className="md-body">
        {(mode === "edit" || mode === "split") && (
          <textarea
            className="md-editor"
            value={doc}
            onChange={(e) => updateDoc(e.target.value)}
            onKeyDown={onEditorKeyDown}
            spellCheck={false}
          />
        )}
        {(mode === "preview" || mode === "split") && (
          <div className="md-preview markdown-body" dangerouslySetInnerHTML={{ __html: html }} />
        )}
        {mode === "wysiwyg" && (
          <div
            ref={wysiwygRef}
            className="md-preview markdown-body md-wysiwyg"
            contentEditable
            suppressContentEditableWarning
            onInput={onWysiwygInput}
          />
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
