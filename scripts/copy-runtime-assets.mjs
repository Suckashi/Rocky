import { copyFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
mkdirSync(new URL("../dist/apps/daemon/src/", import.meta.url), {
  recursive: true,
});
copyFileSync(
  new URL("../apps/daemon/src/attachment-codec.mjs", import.meta.url),
  new URL("../dist/apps/daemon/src/attachment-codec.mjs", import.meta.url),
);
copyFileSync(
  new URL("../apps/daemon/src/promptfoo-worker.mjs", import.meta.url),
  new URL("../dist/apps/daemon/src/promptfoo-worker.mjs", import.meta.url),
);

const target = fileURLToPath(new URL("../dist/scripts/", import.meta.url));
mkdirSync(target, { recursive: true });
copyFileSync(
  new URL("./worker-network-guard.mjs", import.meta.url),
  new URL("../dist/scripts/worker-network-guard.mjs", import.meta.url),
);
