import { randomUUID } from "node:crypto";
import { Store } from "../../apps/daemon/src/store.js";
import { RockyError, type Work } from "../../packages/contracts/src/index.js";

const [root, mode] = process.argv.slice(2);
if (!root || !mode || !process.send)
  throw Error("Synthetic persistence fixture requires parent IPC");
try {
  const store = new Store(root);
  if (mode === "hold") {
    process.send({ status: "ready" });
    // Deliberately skip normal cleanup to exercise OS lock release and stale PID recovery.
    process.on("message", () => process.exit(73));
  } else {
    const work: Work = {
      id: randomUUID(),
      runId: randomUUID(),
      executionSessionId: randomUUID(),
      requestId: randomUUID(),
      text: "Synthetic crash fixture",
      transport: "http",
      mode: "fixture",
      runMode: "normal",
      status: "completed",
      revision: 1,
      answer: "Persisted synthetic result",
      createdAt: new Date().toISOString(),
    };
    store.transaction(() => {
      store.add(work, "synthetic");
      store.event(work, "rocky.work.updated", { work });
      if (mode === "uncommitted") process.exit(74);
    });
    process.send({ status: "committed", workId: work.id }, () =>
      process.exit(75),
    );
  }
} catch (error) {
  process.send(
    { status: error instanceof RockyError ? error.code : "error" },
    () => process.exit(1),
  );
}
