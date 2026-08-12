import type { MinexKernel } from "@minex/kernel";
import { useKernel } from "../kernel-context.js";

interface CommandContribution {
  id: string;
  label?: string;
  handler?: (...args: string[]) => unknown;
}

export function RightBar({ onRun }: { onRun: (result: string) => void }) {
  const kernel = useKernel();
  const runnable = kernel.registry
    .query<CommandContribution>("command")
    .filter((c) => typeof c.value.handler === "function");

  return (
    <aside className="rightbar">
      <div className="section-title">命令</div>
      {runnable.length === 0 && <div className="muted">（无可用命令）</div>}
      {runnable.map((c) => (
        <button
          key={c.id}
          className="btn-ghost"
          style={{ width: "100%", marginBottom: 8 }}
          onClick={() => runCommand(kernel, c.id, onRun)}
        >
          {c.value.label ?? c.value.id}
        </button>
      ))}
    </aside>
  );
}

async function runCommand(
  kernel: MinexKernel,
  id: string,
  onRun: (result: string) => void,
): Promise<void> {
  try {
    const contrib = kernel.registry.get<CommandContribution>("command", id);
    const result = await contrib?.value.handler?.();
    onRun(typeof result === "string" ? result : JSON.stringify(result, null, 2));
  } catch (err) {
    onRun(`错误: ${err instanceof Error ? err.message : String(err)}`);
  }
}
