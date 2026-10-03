import { execFileSync } from "node:child_process";
import { statSync, readFileSync } from "node:fs";
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
  if (!statSync(f).isFile()) continue;
  const size = statSync(f).size;
  if (size > 50 * 1024 * 1024) failures.push("Oversized file: " + f);
  else if (size > 20 * 1024 * 1024) warnings.push("Large file: " + f);
  if (
    /(^|\/)(node_modules|\.rocky[^/]*|browser-profiles|runtime-data)\/|\.sqlite(-.*)?$|(^|\/)\.env($|\.)/.test(
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
console.log(
  JSON.stringify({
    files: files.length,
    failures,
    warnings,
    scope: "Source worktree; P8 will add full release/history gates.",
  }),
);
if (failures.length) process.exitCode = 1;
