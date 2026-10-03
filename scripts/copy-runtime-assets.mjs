import { copyFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const target = fileURLToPath(new URL("../dist/scripts/", import.meta.url));
mkdirSync(target, { recursive: true });
copyFileSync(
  new URL("./worker-network-guard.mjs", import.meta.url),
  new URL("../dist/scripts/worker-network-guard.mjs", import.meta.url),
);
