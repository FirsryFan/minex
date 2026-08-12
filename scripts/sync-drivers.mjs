// 把 packages/demo-driver 的 manifest + dist 同步到 drivers/<driverId>/
// 供运行时 loadDriversFromDir 加载（CLI/UI 宿主使用）
import { cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const driverPkg = join(root, "packages", "demo-driver");
const manifest = JSON.parse(readFileSync(join(driverPkg, "manifest.json"), "utf8"));
const target = join(root, "drivers", manifest.id);

mkdirSync(target, { recursive: true });
cpSync(join(driverPkg, "manifest.json"), join(target, "manifest.json"));
cpSync(join(driverPkg, "dist"), join(target, "dist"), { recursive: true });
// 声明 ESM，消除 Node 的 MODULE_TYPELESS_PACKAGE_JSON 警告
writeFileSync(join(target, "package.json"), JSON.stringify({ type: "module" }, null, 2));
console.log(`synced ${manifest.id} -> drivers/${manifest.id}`);
