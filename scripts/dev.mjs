import { spawn } from "node:child_process";
const env = {
  ...process.env,
  ROCKY_DATA_DIR: process.env.ROCKY_DATA_DIR || ".rocky-dev",
  COPILOTKIT_TELEMETRY_DISABLED: "true",
  SCARF_NO_ANALYTICS: "true",
  PROMPTFOO_DISABLE_TELEMETRY: "1",
  PROMPTFOO_DISABLE_UPDATE: "1",
  LANGSMITH_TRACING: "false",
  LANGCHAIN_TRACING_V2: "false",
};
const children = [
  spawn(process.execPath, ["--import", "tsx", "apps/daemon/src/main.ts"], {
    stdio: "inherit",
    env,
  }),
  spawn(
    process.execPath,
    ["node_modules/vite/bin/vite.js", "--config", "apps/web/vite.config.ts"],
    { stdio: "inherit", env },
  ),
];
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const c of children) c.kill();
  process.exitCode = code;
}
children.forEach((c) => c.on("exit", (code) => stop(code || 0)));
process.on("SIGINT", () => stop());
process.on("SIGTERM", () => stop());
