import { runDev } from "../../scripts/dev.mjs";
if (process.argv.includes("--production"))
  runDev(undefined, { loadEnvFile: false });
else runDev("tests/e2e/fixture-daemon.ts", { loadEnvFile: false });
