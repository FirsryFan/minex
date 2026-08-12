// 扫描 packages/* 中带 manifest.json 的驱动包，同步到 drivers/<driverId>/
// 供运行时 loadDriversFromDir 加载（CLI/Electron 宿主使用）
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const packagesDir = join(root, "packages");

for (const pkgName of readdirSync(packagesDir)) {
  const pkgDir = join(packagesDir, pkgName);
  const manifestPath = join(pkgDir, "manifest.json");
  if (!existsSync(manifestPath)) continue; // 非驱动包（kernel/cli/ui-shell）
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const target = join(root, "drivers", manifest.id);

  mkdirSync(target, { recursive: true });
  cpSync(manifestPath, join(target, "manifest.json"));
  cpSync(join(pkgDir, "dist"), join(target, "dist"), { recursive: true });
  // 复制驱动资源（图标等图片文件），供 manifest.icon 相对路径解析
  if (existsSync(join(pkgDir, "assets"))) {
    cpSync(join(pkgDir, "assets"), join(target, "assets"), { recursive: true });
  }
  // 声明 ESM，消除 Node 的 MODULE_TYPELESS_PACKAGE_JSON 警告
  writeFileSync(join(target, "package.json"), JSON.stringify({ type: "module" }, null, 2));
  console.log(`synced ${manifest.id} -> drivers/${manifest.id}`);
}
