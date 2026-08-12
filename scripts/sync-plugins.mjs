// 把 packages/demo-plugin 的 manifest + dist 同步到 plugins/<pluginId>/
// 供运行时 loadPluginsFromDir 加载（CLI/UI 宿主使用）
import { cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pluginPkg = join(root, "packages", "demo-plugin");
const manifest = JSON.parse(readFileSync(join(pluginPkg, "manifest.json"), "utf8"));
const target = join(root, "plugins", manifest.id);

mkdirSync(target, { recursive: true });
cpSync(join(pluginPkg, "manifest.json"), join(target, "manifest.json"));
cpSync(join(pluginPkg, "dist"), join(target, "dist"), { recursive: true });
// 声明 ESM，消除 Node 的 MODULE_TYPELESS_PACKAGE_JSON 警告
writeFileSync(join(target, "package.json"), JSON.stringify({ type: "module" }, null, 2));
console.log(`synced ${manifest.id} -> plugins/${manifest.id}`);
