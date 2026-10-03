import {
  mkdtempSync,
  cpSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve, relative, delimiter } from "node:path";
import { spawnSync } from "node:child_process";
const root = resolve("."),
  scratch = mkdtempSync(join(tmpdir(), "rocky-no-python-")),
  project = join(scratch, "project"),
  guard = join(scratch, "guard");
mkdirSync(guard);
const trace = join(scratch, "forbidden-tools.txt");
const forbidden = [
  "python",
  "python3",
  "py",
  "uv",
  "pip",
  "pip3",
  "gcc",
  "g++",
  "clang",
  "cl",
  "msbuild",
];
for (const name of forbidden) {
  const path = join(guard, name + (process.platform === "win32" ? ".cmd" : ""));
  writeFileSync(
    path,
    process.platform === "win32"
      ? "@echo off\r\necho " + name + '>>"' + trace + '"\r\nexit /b 97\r\n'
      : "#!/bin/sh\necho " + name + ' >> "' + trace + '"\nexit 97\n',
    { mode: 0o755 },
  );
}
cpSync(root, project, {
  recursive: true,
  filter: (path) =>
    !relative(root, path)
      .split(/[\\/]/)
      .some(
        (p) =>
          p === "node_modules" ||
          p === ".git" ||
          p === "dist" ||
          p === "test-results" ||
          p === "playwright-report" ||
          p.startsWith(".rocky"),
      ),
});
const env = {
  ...process.env,
  PATH: [
    guard,
    dirname(process.execPath),
    ...(process.platform === "win32"
      ? [join(process.env.SystemRoot, "System32")]
      : ["/usr/bin", "/bin"]),
  ].join(delimiter),
  NODE_GYP_FORCE_PYTHON: join(
    guard,
    process.platform === "win32" ? "python.cmd" : "python",
  ),
  PYTHON: join(guard, "python"),
  COPILOTKIT_TELEMETRY_DISABLED: "true",
  SCARF_NO_ANALYTICS: "true",
  PROMPTFOO_DISABLE_TELEMETRY: "1",
  PROMPTFOO_DISABLE_UPDATE: "1",
};
const steps = [];
const npmVersion = spawnSync(
  process.execPath,
  [process.env.npm_execpath, "--version"],
  { cwd: project, env, encoding: "utf8" },
);
if (npmVersion.status !== 0)
  throw Error("Could not verify the npm executable used by this check");
for (const args of [
  ["ci"],
  ["run", "check"],
  ["run", "build"],
  ["test"],
  ["run", "test:learning"],
]) {
  const result = spawnSync(
    process.execPath,
    [process.env.npm_execpath, ...args],
    {
      cwd: project,
      env,
      encoding: "utf8",
      maxBuffer: 20 * 1024 * 1024,
      timeout: 240000,
    },
  );
  steps.push({
    command: "npm " + args.join(" "),
    exitCode: result.status,
    output: result.stdout + "\n" + result.stderr,
    error: result.error?.message,
  });
  console.log(steps.at(-1).command + ": " + result.status);
  if (result.status !== 0) break;
}
const attempts = existsSync(trace)
  ? readFileSync(trace, "utf8").trim().split("\n")
  : [];
mkdirSync(".rocky-reports", { recursive: true });
writeFileSync(
  ".rocky-reports/no-python.json",
  JSON.stringify(
    {
      platform: process.platform,
      arch: process.arch,
      node: process.version,
      npm: npmVersion.stdout.trim(),
      inheritedUserAgent: process.env.npm_config_user_agent,
      scratch,
      mode: "fixture",
      steps,
      forbiddenToolAttempts: attempts,
      limitations: [
        "Constrained-PATH clean-copy install on this host; not an Ubuntu or pristine-machine result.",
        "Temporary evidence retained for inspection.",
      ],
    },
    null,
    2,
  ),
);
if (
  steps.length !== 5 ||
  steps.some((s) => s.exitCode !== 0) ||
  attempts.length
)
  process.exitCode = 1;
