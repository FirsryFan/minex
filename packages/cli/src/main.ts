import { createKernel, type MinexKernel } from "@minex/kernel";
import * as path from "node:path";

const HELP = `Minex CLI — 无 UI 使用内核

用法:
  minex run <commandId> [args...]                         执行驱动命令
  minex config get <driverId> [key]                      读驱动设置
  minex config set <driverId> <key> <json值>             写驱动设置
  minex drivers list                                     列出驱动与状态
  minex drivers <activate|deactivate|reload> <driverId>  驱动生命周期

示例:
  minex run demo.sayHello
  minex config set minex.demo config '{"greeting":"Hi"}'
`;

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export async function main(
  argv: string[],
  opts?: { driversDir?: string; storageDir?: string },
): Promise<number> {
  const driversDir = opts?.driversDir ?? path.resolve(process.cwd(), "drivers");
  const storageDir = opts?.storageDir ?? path.resolve(process.cwd(), ".minex-data");
  const kernel = createKernel({ storageDir });

  const [cmd, ...rest] = argv;
  try {
    if (!cmd || cmd === "help" || cmd === "--help" || cmd === "-h") {
      console.log(HELP);
      return 0;
    }
    // 加载并激活全部驱动（逐个容错，C1：一个失败不影响其余，只读命令仍可用）
    const { manifests, failed } = await kernel.drivers.loadFromDir(driversDir);
    for (const m of manifests) {
      try {
        await kernel.drivers.activate(m.id);
      } catch (err) {
        failed.push({ id: m.id, error: errMsg(err) });
      }
    }
    for (const f of failed) console.error(`[driver unavailable] ${f.id}: ${f.error}`);

    switch (cmd) {
      case "run":
        return await runCommand(kernel, rest);
      case "config":
        return await configCmd(kernel, rest);
      case "drivers":
        return await driversCmd(kernel, rest);
      default:
        console.error(`未知命令: ${cmd}\n`);
        console.log(HELP);
        return 1;
    }
  } catch (err) {
    // C3/C4/C5：顶层统一捕获，输出用户可读错误而非 stack trace
    console.error(`错误: ${errMsg(err)}`);
    return 1;
  } finally {
    await kernel.destroy();
  }
}

export async function runCommand(kernel: MinexKernel, args: string[]): Promise<number> {
  const [commandId] = args;
  if (!commandId) {
    console.error("usage: minex run <commandId> [args...]");
    return 1;
  }
  const contrib = kernel.registry.get<{ handler?: (...args: string[]) => unknown }>("command", commandId);
  if (!contrib) {
    console.error(`command not found: ${commandId}`);
    return 1;
  }
  if (typeof contrib.value.handler !== "function") {
    console.error(`command "${commandId}" has no handler (driver not active?)`);
    return 1;
  }
  const result = await contrib.value.handler(...args.slice(1));
  if (result !== undefined) {
    console.log(typeof result === "string" ? result : JSON.stringify(result, null, 2));
  }
  return 0;
}

export async function configCmd(kernel: MinexKernel, args: string[]): Promise<number> {
  const [op, driverId, key, value] = args;
  if (op === "get") {
    if (!driverId) {
      console.error("usage: minex config get <driverId> [key]");
      return 1;
    }
    const ns = kernel.storage.namespace(driverId);
    if (key !== undefined) {
      const v = ns.get(key);
      console.log(v === undefined ? "(unset)" : JSON.stringify(v, null, 2));
    } else {
      const all: Record<string, unknown> = {};
      for (const k of ns.list()) all[k] = ns.get(k);
      console.log(JSON.stringify(all, null, 2));
    }
    return 0;
  }
  if (op === "set") {
    if (!driverId || key === undefined || value === undefined) {
      console.error("usage: minex config set <driverId> <key> <json值>");
      return 1;
    }
    let parsed: unknown = value;
    try {
      parsed = JSON.parse(value);
    } catch {
      // 非 JSON → 保留字符串
    }
    kernel.storage.namespace(driverId).set(key, parsed);
    console.log(`set ${driverId}.${key} = ${JSON.stringify(parsed)}`);
    return 0;
  }
  console.error(`未知 config 操作: ${op}`);
  return 1;
}

export async function driversCmd(kernel: MinexKernel, args: string[]): Promise<number> {
  const [op, driverId] = args;
  if (op === "list") {
    for (const m of kernel.drivers.list()) {
      console.log(`${m.manifest.id}\t${m.manifest.version}\t${kernel.drivers.getState(m.manifest.id)}`);
    }
    return 0;
  }
  if ((op === "activate" || op === "deactivate" || op === "reload") && driverId) {
    if (op === "activate") await kernel.drivers.activate(driverId);
    if (op === "deactivate") await kernel.drivers.deactivate(driverId);
    if (op === "reload") await kernel.drivers.reload(driverId);
    console.log(`${driverId}: ${kernel.drivers.getState(driverId)}`);
    return 0;
  }
  console.error("usage: minex drivers list | drivers <activate|deactivate|reload> <driverId>");
  return 1;
}
