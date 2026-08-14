import { useEffect, useRef, useState } from "react";
import type { MinexKernel } from "@minex/kernel";
import { loadChatHistory, saveChatHistory, type ChatMessageView } from "./chat-history.js";

const SYSTEM_PROMPT = "你是一个乐于助人的 AI 助手，用中文回答。";

/** agent 能力子集（宿主视图取能力值要 .value） */
interface AgentCap {
  run(systemPrompt: string, history: unknown[], maxIterations?: number): AsyncIterable<AgentEvent>;
}

interface AgentEvent {
  kind: "text" | "toolCall" | "done" | "error";
  delta?: string;
  name?: string;
  args?: unknown;
  message?: string;
}

interface MarkdownCap {
  render(src: string): string;
}

/**
 * Agent 聊天工作区（task 1-3）：主区聊天界面。
 * 发消息 → agent.run 流式回复（text 逐字追加 / toolCall 工具卡片 / error 红色 / done 收尾）；
 * 聊天记录每次变化落盘 localStorage（D11：刷新不丢）；卸载时中断进行中的流（cancelledRef）。
 * instanceId 先占位（阶段 2 会话隔离用），现恒 undefined → key chatHistory@0。
 */
export default function ChatView({ kernel, instanceId }: { kernel: MinexKernel; instanceId?: number }) {
  // .value 纪律：registry.get 返回 Contribution，能力值在 .value
  const agent = kernel.registry.get<AgentCap>("agent", "default")?.value;
  const md = kernel.registry.get<MarkdownCap>("markdown", "render")?.value;

  // 初始值 = 落盘历史（非空数组——刷新不丢）
  const [messages, setMessages] = useState<ChatMessageView[]>(() => loadChatHistory(kernel, instanceId));
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const cancelledRef = useRef(false);

  // 卸载时中断进行中的 for await（loop 内检查 cancelledRef）
  useEffect(() => {
    return () => {
      cancelledRef.current = true;
    };
  }, []);

  // messages 每次变化 → 落盘（首次运行写回 loadChatHistory 的同值，无副作用）
  useEffect(() => {
    saveChatHistory(kernel, instanceId, messages);
  }, [kernel, instanceId, messages]);

  async function send(): Promise<void> {
    const text = input.trim();
    if (!text || streaming || !agent) return;
    setInput("");
    setStreaming(true);
    cancelledRef.current = false;

    const userMsg: ChatMessageView = { role: "user", content: text };
    setMessages((prev) => [...prev, userMsg]);

    // history = user/assistant 的 {role, content} 映射（含本轮新消息；error/tool 不进历史）
    const history = [...messages, userMsg]
      .filter((m) => (m.role === "user" || m.role === "assistant") && !m.error)
      .map((m) => ({ role: m.role, content: m.content }));

    try {
      for await (const ev of agent.run(SYSTEM_PROMPT, history)) {
        if (cancelledRef.current) break;
        if (ev.kind === "text") {
          // 流式逐字追加：尾部已是 assistant 则追加 delta，否则新建
          setMessages((prev) => {
            const last = prev[prev.length - 1];
            if (last && last.role === "assistant" && !last.error) {
              const next = [...prev];
              next[next.length - 1] = { ...last, content: last.content + (ev.delta ?? "") };
              return next;
            }
            return [...prev, { role: "assistant", content: ev.delta ?? "" }];
          });
        } else if (ev.kind === "toolCall") {
          // 工具卡片：toolName + 参数 JSON
          setMessages((prev) => [
            ...prev,
            { role: "tool", content: "", toolName: ev.name, args: ev.args },
          ]);
        } else if (ev.kind === "error") {
          setMessages((prev) => [...prev, { role: "assistant", content: ev.message ?? "发生错误", error: true }]);
        } else if (ev.kind === "done") {
          break;
        }
      }
    } finally {
      setStreaming(false);
    }
  }

  return (
    <div className="chat-view">
      <div className="chat-messages">
        {messages.map((m, i) => {
          if (m.role === "tool") {
            return (
              <div key={i} className="chat-msg tool">
                <div className="chat-tool-name">调用工具 {m.toolName ?? "?"}</div>
                {m.args !== undefined && (
                  <pre className="chat-tool-args">{JSON.stringify(m.args, null, 2)}</pre>
                )}
              </div>
            );
          }
          // assistant 内容用 markdown 渲染（dangerouslySetInnerHTML，参考 markdown workspace preview）
          const html = m.role === "assistant" && md && m.content ? md.render(m.content) : null;
          return (
            <div key={i} className={`chat-msg ${m.role}${m.error ? " error" : ""}`}>
              {html ? (
                <div className="markdown-body" dangerouslySetInnerHTML={{ __html: html }} />
              ) : (
                <div>{m.content}</div>
              )}
            </div>
          );
        })}
      </div>
      <div className="chat-input-row">
        <input
          value={input}
          placeholder="输入消息…"
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void send();
          }}
          disabled={streaming}
        />
        <button className="btn" onClick={() => void send()} disabled={streaming || input.trim() === ""}>
          发送
        </button>
      </div>
    </div>
  );
}
