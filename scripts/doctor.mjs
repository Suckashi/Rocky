import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
const pkg = JSON.parse(readFileSync("package.json", "utf8"));
let remote = [];
try {
  remote = execFileSync("git", ["remote"], { encoding: "utf8" })
    .trim()
    .split("\n")
    .filter(Boolean);
} catch {}
console.log(
  JSON.stringify(
    {
      productId: "rocky",
      platform: process.platform,
      arch: process.arch,
      node: { actual: process.version, required: pkg.engines.node },
      npmRequired: pkg.engines.npm,
      installed: existsSync("node_modules"),
      remoteConfigured: remote.length > 0,
      model: { configured: false, mode: "fixture-only" },
      learning: {
        automatic: "off",
        developmentEval: existsSync(".rocky-eval/report.json"),
      },
      ubuntuEvidence: "not_run",
      browserOverride: !!process.env.ROCKY_TEST_BROWSER,
    },
    null,
    2,
  ),
);
