import { runDev } from "../../scripts/dev.mjs";
if (process.argv.includes("--production")) runDev();
else runDev("tests/e2e/fixture-daemon.ts");
