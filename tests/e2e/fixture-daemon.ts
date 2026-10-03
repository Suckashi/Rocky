import { serve } from "@hono/node-server";
import { createApp } from "../../apps/daemon/src/http.js";
import { FixtureWorkService } from "../support/fixture-work-service.js";
const root = process.env.ROCKY_DATA_DIR;
if (!root || !root.endsWith(".rocky-e2e"))
  throw Error("Explicit isolated E2E data root required");
const service = new FixtureWorkService(root);
const server = serve(
  { fetch: createApp(service).fetch, hostname: "127.0.0.1", port: 3211 },
  () =>
    console.log(
      "Rocky TEST HARNESS: configured models may use synthetic tools; not production evidence",
    ),
);
let closing = false;
async function stop() {
  if (closing) return;
  closing = true;
  server.close();
  await service.close();
  process.exit(0);
}
process.on("SIGINT", () => void stop());
process.on("SIGTERM", () => void stop());
