import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
const action = process.argv[2];
if (action === "browser") {
  const cli = fileURLToPath(
    new URL("../node_modules/playwright-core/cli.js", import.meta.url),
  );
  if (!existsSync(cli)) throw Error("Run npm ci first");
  console.log(
    "Downloading the pinned Playwright Chromium browser for this user. No OS packages, services or container engine will be installed.",
  );
  const child = spawn(process.execPath, [cli, "install", "chromium"], {
    stdio: "inherit",
    windowsHide: true,
  });
  child.on("error", () => {
    console.error("Browser setup could not start");
    process.exitCode = 1;
  });
  child.on("exit", (code) => {
    process.exitCode = code ?? 1;
  });
} else if (!action || ["--help", "help"].includes(action))
  console.log(
    "Optional setup: npm run setup -- browser\nCore and fixture Learning require Node/npm only. Container engines are owner-installed separately; Rocky never installs them or changes system proxy, DNS or TLS.",
  );
else {
  console.error("Unknown setup target. Use browser or --help.");
  process.exitCode = 1;
}
