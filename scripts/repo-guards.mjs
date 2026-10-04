import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync } from "node:fs";
const files = execFileSync(
  "git",
  ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
  { encoding: "utf8" },
)
  .split("\0")
  .filter(Boolean);
const failures = [],
  warnings = [];
for (const f of new Set(files)) {
  if (!existsSync(f)) continue;
  const stat = lstatSync(f);
  if (stat.isSymbolicLink()) {
    failures.push("Linked source path: " + f);
    continue;
  }
  if (!stat.isFile()) continue;
  const size = stat.size;
  if (size > 50 * 1024 * 1024) failures.push("Oversized file: " + f);
  else if (size > 20 * 1024 * 1024) warnings.push("Large file: " + f);
  if (
    /(^|\/)(node_modules|\.rocky[^/]*|browser-profiles|runtime-data|private-eval-data|learning-runs|learning-evaluations)\/|\.(sqlite|db)(-.*)?$|(^|\/)\.env($|\.)|(^|\/)rocky-backup\.json$/.test(
      f,
    ) &&
    !f.endsWith(".env.example")
  )
    failures.push("Private runtime path: " + f);
  if (size < 2 * 1024 * 1024 && !/\.(png|woff2?)$/.test(f)) {
    const text = readFileSync(f, "utf8");
    if (
      /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----|\b(?:ghp|github_pat)_[A-Za-z0-9_]{30,}|\bsk-[A-Za-z0-9]{32,}/.test(
        text,
      )
    )
      failures.push("Potential secret: " + f);
  }
}
let historyObjects = null,
  packageFiles = null;
if (process.argv.includes("--history")) {
  const objects = execFileSync("git", ["rev-list", "--objects", "--all"], {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  })
    .trim()
    .split("\n")
    .filter(Boolean);
  const records = execFileSync(
    "git",
    ["cat-file", "--batch-check=%(objectname) %(objecttype) %(objectsize)"],
    {
      input: objects.map((line) => line.split(" ")[0]).join("\n") + "\n",
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
    },
  )
    .trim()
    .split("\n");
  historyObjects = records.length;
  for (const record of records) {
    const [id, type, rawSize] = record.split(" "),
      size = Number(rawSize);
    if (type !== "blob") continue;
    if (size > 50 * 1024 * 1024) {
      failures.push("Oversized historical blob: " + id);
      continue;
    }
    if (size > 2 * 1024 * 1024) continue;
    const bytes = execFileSync("git", ["cat-file", "blob", id], {
      maxBuffer: 2 * 1024 * 1024 + 1024,
    });
    if (bytes.includes(0)) continue;
    if (
      /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----|\b(?:ghp|github_pat)_[A-Za-z0-9_]{30,}|\bsk-[A-Za-z0-9]{32,}/.test(
        bytes.toString("utf8"),
      )
    )
      failures.push("Potential secret in historical blob: " + id);
  }
}
if (process.argv.includes("--package")) {
  if (!process.env.npm_execpath) throw Error("Run package guard through npm");
  const [manifest] = JSON.parse(
    execFileSync(
      process.execPath,
      [
        process.env.npm_execpath,
        "pack",
        "--dry-run",
        "--json",
        "--ignore-scripts",
      ],
      { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
    ),
  );
  packageFiles = manifest.files.length;
  for (const file of manifest.files) {
    if (
      /(^|\/)(\.git|references|node_modules|browser-profiles|runtime-data|private-eval-data|learning-runs|learning-evaluations|\.rocky[^/]*)\/|\.(sqlite|db)(-.*)?$|(^|\/)\.env($|\.)|rocky-backup\.json$/.test(
        file.path,
      )
    )
      failures.push("Private/reference package path: " + file.path);
    if (file.size > 50 * 1024 * 1024)
      failures.push("Oversized package file: " + file.path);
  }
  for (const required of [
    "LICENSE",
    "NOTICE",
    "THIRD_PARTY_NOTICES.md",
    "README.md",
    "README.zh-TW.md",
    "SECURITY.md",
    "docs/implementation/dependency-licenses.json",
    "dist/apps/daemon/src/main.js",
    "dist/web/index.html",
    "dist/scripts/data-command.js",
    "dist/apps/daemon/src/attachment-codec.mjs",
    "dist/apps/daemon/src/promptfoo-worker.mjs",
    "dist/scripts/worker-network-guard.mjs",
  ])
    if (!manifest.files.some((file) => file.path === required))
      failures.push("Missing runtime package file: " + required);
}
console.log(
  JSON.stringify({
    files: files.length,
    failures,
    warnings,
    historyObjects,
    packageFiles,
    scope:
      "Source worktree; optional --history checks local Git objects and --package checks the actual npm dry-run inventory. Pattern scan is not a universal secret detector.",
  }),
);
if (failures.length) process.exitCode = 1;
