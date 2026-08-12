import { createKernel, type MinexKernel } from "@minex/kernel";
import * as path from "node:path";

const HELP = `Minex CLI — 无 UI 使用内核

用法:
  minex run <commandId> [args...]                         执行插件命令
  minex config get <pluginId> [key]                      读插件设置
  minex config set <pluginId> <key> <json值>             写插件设置
  minex plugins list                                     列出插件与状态
  minex plugins <activate|deactivate|reload> <pluginId>  插件生命周期

示例:
  minex run demo.sayHello
  minex config set minex.demo config '{"greeting":"Hi"}'
`;

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export async function main(
  argv: string[],
  opts?: { pluginsDir?: string; storageDir?: string },
): Promise<number> {
  const pluginsDir = opts?.pluginsDir ?? path.resolve(process.cwd(), "plugins");
  const storageDir = opts?.storageDir ?? path.resolve(process.cwd(), ".minex-data");
  const kernel = createKernel({ storageDir });

  const [cmd, ...rest] = argv;
  try {
    if (!cmd || cmd === "help" || cmd === "--help" || cmd === "-h") {
      console.log(HELP);
      return 0;
    }
    // 加载并激活全部插件（逐个容错，C1：一个失败不影响其余，只读命令仍可用）
    const { manifests, failed } = await kernel.plugins.loadFromDir(pluginsDir);
    for (const m of manifests) {
      try {
        await kernel.plugins.activate(m.id);
      } catch (err) {
        failed.push({ id: m.id, error: errMsg(err) });
      }
    }
    for (const f of failed) console.error(`[plugin unavailable] ${f.id}: ${f.error}`);

    switch (cmd) {
      case "run":
        return await runCommand(kernel, rest);
      case "config":
        return await configCmd(kernel, rest);
      case "plugins":
        return await pluginsCmd(kernel, rest);
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
    console.error(`command "${commandId}" has no handler (plugin not active?)`);
    return 1;
  }
  const result = await contrib.value.handler(...args.slice(1));
  if (result !== undefined) {
    console.log(typeof result === "string" ? result : JSON.stringify(result, null, 2));
  }
  return 0;
}

export async function configCmd(kernel: MinexKernel, args: string[]): Promise<number> {
  const [op, pluginId, key, value] = args;
  if (op === "get") {
    if (!pluginId) {
      console.error("usage: minex config get <pluginId> [key]");
      return 1;
    }
    const ns = kernel.storage.namespace(pluginId);
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
    if (!pluginId || key === undefined || value === undefined) {
      console.error("usage: minex config set <pluginId> <key> <json值>");
      return 1;
    }
    let parsed: unknown = value;
    try {
      parsed = JSON.parse(value);
    } catch {
      // 非 JSON → 保留字符串
    }
    kernel.storage.namespace(pluginId).set(key, parsed);
    console.log(`set ${pluginId}.${key} = ${JSON.stringify(parsed)}`);
    return 0;
  }
  console.error(`未知 config 操作: ${op}`);
  return 1;
}

export async function pluginsCmd(kernel: MinexKernel, args: string[]): Promise<number> {
  const [op, pluginId] = args;
  if (op === "list") {
    for (const m of kernel.plugins.list()) {
      console.log(`${m.manifest.id}\t${m.manifest.version}\t${kernel.plugins.getState(m.manifest.id)}`);
    }
    return 0;
  }
  if ((op === "activate" || op === "deactivate" || op === "reload") && pluginId) {
    if (op === "activate") await kernel.plugins.activate(pluginId);
    if (op === "deactivate") await kernel.plugins.deactivate(pluginId);
    if (op === "reload") await kernel.plugins.reload(pluginId);
    console.log(`${pluginId}: ${kernel.plugins.getState(pluginId)}`);
    return 0;
  }
  console.error("usage: minex plugins list | plugins <activate|deactivate|reload> <pluginId>");
  return 1;
}
