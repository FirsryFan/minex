import type { MinexKernel } from "@minex/kernel";
import { useEffect, useMemo, useRef, useState } from "react";
import { Columns2, Eye, Pen, Zap, type LucideIcon } from "lucide-react";
import "highlight.js/styles/github.css";
import "katex/dist/katex.min.css";
import TurndownService from "turndown";
import { renderMarkdown, type RenderOptions } from "./markdown.js";
import { applyFormat, shortcutToAction } from "./shortcuts.js";
import { FILE_SAVED_TOPIC, isOpenFilePayload, OPEN_FILE_TOPIC } from "./events.js";

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
/** 自动保存防抖间隔（编辑停顿后写回文件） */
const AUTO_SAVE_DELAY = 800;
const turndown = new TurndownService();

/** filesystem 能力中 markdown 用到的子集（结构类型，避免跨包 import）。 */
interface FileSystemOps {
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
}

/** .ses 会话文件判断（本地实现，避免跨包 import 受 rootDir 限制） */
const isSessionPath = (p: string): boolean => p.toLowerCase().endsWith(".ses");

/** session 视图能力结构类型（session 驱动注册 `session.md`，markdown 按结构消费，零源码 import） */
interface SessionMdView {
  toMarkdown(s: unknown): string;
  isSession(s: unknown): boolean;
  saveMarkdown(s: unknown, doc: string): Promise<unknown>;
}

const MODES: { id: Mode; title: string; Icon: LucideIcon }[] = [
  { id: "edit", title: "编辑", Icon: Pen },
  { id: "preview", title: "预览", Icon: Eye },
  { id: "split", title: "分屏", Icon: Columns2 },
  { id: "wysiwyg", title: "即时", Icon: Zap },
];

/**
 * markdown 编辑器工作区：编辑 / 预览 / 分屏 / 即时（所见即所得）四模式。
 * 打开文件后：编辑停顿自动保存 + Ctrl/Cmd+S 立即保存（拦截浏览器默认「保存网页」）。
 */
export default function WorkspaceView({ kernel }: { kernel: MinexKernel }) {
  const [mode, setMode] = useState<Mode>("split");
  const [doc, setDoc] = useState<string>(() => kernel.storage.namespace("minex.markdown").get<string>(DOC_KEY) ?? DEFAULT_DOC);
  const [currentPath, setCurrentPath] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState("");
  const [renderOpts, setRenderOpts] = useState<RenderOptions>(() => readRenderOpts(kernel));
  const wysiwygRef = useRef<HTMLDivElement>(null);
  const openSeqRef = useRef(0); // 竞态防护：连续打开时只应用最后一次请求的结果
  const autoSaveRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const docRef = useRef(doc);
  const pathRef = useRef(currentPath);
  const sessionRef = useRef<unknown>(null); // 当前打开的 .ses 会话（结构由 session 能力持有）
  const didEditRef = useRef(false); // 是否真编辑过（打开文件不算；防止打开即触发无意义自动保存，审查 m1）

  const fs = useMemo<FileSystemOps | undefined>(
    () => kernel.registry.get<FileSystemOps>("filesystem", "default")?.value,
    [kernel],
  );

  // session 视图能力（.ses 主链 markdown 转换 + 保存，索引一致性由 session 驱动保证）
  const sessionMd = useMemo<SessionMdView | undefined>(
    () => kernel.registry.get<SessionMdView>("session.md", "default")?.value,
    [kernel],
  );

  const html = useMemo(() => renderMarkdown(doc, renderOpts), [doc, renderOpts]);

  // 同步最新值到 ref（异步写文件用最新值，避免闭包捕获过期状态）
  useEffect(() => {
    docRef.current = doc;
  }, [doc]);
  useEffect(() => {
    pathRef.current = currentPath;
  }, [currentPath]);

  useEffect(() => {
    const offs = [
      kernel.events.on("minex:dataChanged", () => setRenderOpts(readRenderOpts(kernel))),
      kernel.events.on(OPEN_FILE_TOPIC, (payload) => {
        if (isOpenFilePayload(payload)) void openPath(payload.path);
      }),
    ];
    return () => offs.forEach((off) => off());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kernel]);

  // 挂载时补开上次打开的文件（sidebar 记录于 filesystem 命名空间；尚未授权根目录时 readFile 抛错则忽略）
  useEffect(() => {
    const last = kernel.storage.namespace("minex.filesystem").get<string>("lastOpenPath");
    if (last) void openPath(last);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Ctrl/Cmd+S：抢在浏览器默认「保存网页」之前保存当前文档（preventDefault 改变优先级）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void persistDoc();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [kernel]);

  // 自动保存：有打开文件且真编辑过时，编辑停顿 AUTO_SAVE_DELAY 后写回文件（didEdit 防「打开即保存」，审查 m1）
  useEffect(() => {
    if (!currentPath || !didEditRef.current) return;
    setSaveStatus("编辑中…");
    if (autoSaveRef.current) clearTimeout(autoSaveRef.current);
    autoSaveRef.current = setTimeout(() => {
      void persistDoc();
    }, AUTO_SAVE_DELAY);
    return () => {
      if (autoSaveRef.current) clearTimeout(autoSaveRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, currentPath]);

  async function openPath(path: string): Promise<void> {
    if (!fs) return;
    const seq = ++openSeqRef.current;
    didEditRef.current = false; // 打开文件不算编辑
    try {
      if (isSessionPath(path)) {
        // .ses：读会话 → 主链渲染为 markdown（markdown 编辑器原生打开）
        const raw = await fs.readFile(path);
        if (seq !== openSeqRef.current) return;
        const parsed = JSON.parse(raw) as unknown;
        if (!sessionMd?.isSession(parsed)) throw new Error("会话文件格式不合法");
        if (autoSaveRef.current) clearTimeout(autoSaveRef.current);
        sessionRef.current = parsed;
        setCurrentPath(path);
        setDoc(sessionMd.toMarkdown(parsed));
        setSaveStatus("会话主链（markdown 视图）");
        return;
      }
      const content = await fs.readFile(path);
      if (seq !== openSeqRef.current) return; // 期间又请求了别的文件，丢弃过期结果
      if (autoSaveRef.current) clearTimeout(autoSaveRef.current);
      sessionRef.current = null;
      setCurrentPath(path);
      setDoc(content);
      setSaveStatus("");
    } catch (err) {
      if (seq === openSeqRef.current) {
        setSaveStatus(`打开失败：${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  /** 写回当前文件（自动保存 / Ctrl+S 共用；.ses 走会话能力保持索引一致） */
  async function persistDoc(): Promise<void> {
    if (!fs || !pathRef.current) return;
    try {
      if (isSessionPath(pathRef.current)) {
        if (!sessionRef.current || !sessionMd) throw new Error("会话未加载");
        const updated = await sessionMd.saveMarkdown(sessionRef.current, docRef.current);
        sessionRef.current = updated;
        didEditRef.current = false;
        setSaveStatus("会话已保存");
        return;
      }
      await fs.writeFile(pathRef.current, docRef.current);
      kernel.events.emit(FILE_SAVED_TOPIC, { path: pathRef.current });
      didEditRef.current = false;
      setSaveStatus("已保存");
    } catch (err) {
      setSaveStatus(`保存失败：${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // 进入即时模式时，把渲染结果写入 contentEditable（仅进入时同步，避免编辑中光标重置）
  useEffect(() => {
    if (mode === "wysiwyg" && wysiwygRef.current) {
      wysiwygRef.current.innerHTML = renderMarkdown(doc, renderOpts);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  function updateDoc(text: string): void {
    didEditRef.current = true;
    setDoc(text);
    kernel.storage.namespace("minex.markdown").set(DOC_KEY, text);
  }

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
      didEditRef.current = true;
      const md = turndown.turndown(wysiwygRef.current.innerHTML);
      setDoc(md);
      kernel.storage.namespace("minex.markdown").set(DOC_KEY, md);
    }
  }

  return (
    <div className="md-workspace">
      <div className="md-toolbar">
        {/* 模式按钮组：主体顶部左侧 */}
        <div className="md-modes">
          {MODES.map(({ id, title, Icon }) => (
            <button key={id} className={`md-mode${mode === id ? " active" : ""}`} title={title} onClick={() => setMode(id)}>
              <Icon size={14} />
            </button>
          ))}
        </div>
        {/* 文件名：主体顶部居中 */}
        <div className="md-file" title={currentPath ?? "尚未打开文件"}>
          {currentPath ?? "未打开文件"}
        </div>
        {/* 右侧：自动保存状态 */}
        <div className="md-toolbar-right">
          {saveStatus && <span className="md-save-msg">{saveStatus}</span>}
        </div>
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
