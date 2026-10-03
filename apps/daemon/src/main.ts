import "../../../packages/agent-runtime/src/environment.js";
import { serve } from "@hono/node-server";
import { join } from "node:path";
import { homedir } from "node:os";
import { createApp } from "./http.js";
import { WorkService } from "./work-service.js";
const root =
  process.env.ROCKY_DATA_DIR ??
  (process.platform === "win32"
    ? process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, "Rocky")
    : join(
        process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share"),
        "rocky",
      ));
if (!root) throw Error("No usable Rocky data directory");
const service = new WorkService(root);
const server = serve(
  { fetch: createApp(service).fetch, hostname: "127.0.0.1", port: 3211 },
  () => console.log("Rocky daemon: http://127.0.0.1:3211"),
);
let closing = false;
async function shutdown() {
  if (closing) return;
  closing = true;
  server.close();
  await service.close();
  process.exit(0);
}
process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
