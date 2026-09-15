#!/usr/bin/env node
/**
 * Repo kökündeki browser-extension/ kaynağını frontend/public altına kopyalar
 * ve indirilebilir ZIP üretir (Docker / yarn build öncesi).
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { execFileSync } from "child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const frontendRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(frontendRoot, "..");
const publicDir = path.join(frontendRoot, "public");
const destDir = path.join(publicDir, "browser-extension");
const downloadsDir = path.join(publicDir, "downloads");
const zipPath = path.join(downloadsDir, "tamkobi-browser-extension.zip");
// Docker build context is ./frontend only — repo-root extension may be absent.
const srcCandidates = [
  path.join(repoRoot, "browser-extension"),
  path.join(frontendRoot, "browser-extension"),
  destDir,
];
const src = srcCandidates.find((p) => fs.existsSync(path.join(p, "manifest.json")));

function rmrf(p) {
  fs.rmSync(p, { recursive: true, force: true });
}

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const name of fs.readdirSync(from)) {
    if (name === "README.md" || name === ".DS_Store") continue;
    const a = path.join(from, name);
    const b = path.join(to, name);
    if (fs.statSync(a).isDirectory()) copyDir(a, b);
    else fs.copyFileSync(a, b);
  }
}

if (!src) {
  console.warn("[pack-browser-extension] kaynak yok (browser-extension/manifest.json)");
  process.exit(0);
}

if (path.resolve(src) !== path.resolve(destDir)) {
  rmrf(destDir);
  copyDir(src, destDir);
}
fs.mkdirSync(downloadsDir, { recursive: true });
rmrf(zipPath);

const staging = path.join(downloadsDir, "_pack_ext");
rmrf(staging);
copyDir(src, path.join(staging, "tamkobi-browser-extension"));
try {
  execFileSync("zip", ["-r", "-q", zipPath, "tamkobi-browser-extension"], { cwd: staging });
} catch {
  // zip yoksa python fallback
  execFileSync("python3", [
    "-c",
    `import zipfile, pathlib
root=pathlib.Path(${JSON.stringify(path.join(staging, "tamkobi-browser-extension"))})
out=pathlib.Path(${JSON.stringify(zipPath)})
with zipfile.ZipFile(out,'w',zipfile.ZIP_DEFLATED) as z:
  for p in root.rglob('*'):
    if p.is_file():
      z.write(p, pathlib.Path('tamkobi-browser-extension')/p.relative_to(root))
`,
  ]);
}
rmrf(staging);
const size = fs.statSync(zipPath).size;
console.log(`[pack-browser-extension] ${zipPath} (${size} bytes)`);
