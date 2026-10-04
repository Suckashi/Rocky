// Runs before the E2E daemon owns its isolated store. No production fault API.
import { randomUUID } from "node:crypto";
import { join, resolve } from "node:path";
import { writeFileSync } from "node:fs";
import { Store } from "../../apps/daemon/src/store.js";
import { OperationLedger } from "../../apps/daemon/src/operation-ledger.js";
import { workSchema } from "../../packages/contracts/src/index.js";
import { connectFixture } from "../../packages/agent-runtime/src/mcp.js";
const root = resolve(process.env.ROCKY_DATA_DIR ?? ".rocky-e2e");
if (!root.endsWith(".rocky-e2e")) throw Error("Isolated E2E root required");
const store = new Store(root),
  ledger = new OperationLedger(store);
const seeds = [];
try {
  for (const recorded of process.env.ROCKY_E2E_EMPTY === "1"
    ? []
    : [true, false]) {
    const work = workSchema.parse({
      id: randomUUID(),
      runId: randomUUID(),
      executionSessionId: randomUUID(),
      requestId: randomUUID(),
      text: `Reconciliation UI ${randomUUID()}`,
      transport: "http",
      mode: "fixture",
      runMode: "normal",
      status: "running",
      revision: 1,
      answer: "",
      createdAt: new Date().toISOString(),
    });
    store.add(work, "e2e");
    const prepared = ledger.prepare(
      work,
      "lost-result",
      "write_sample",
      { value: "browser synthetic" },
      "e2e",
    );
    const dispatched = ledger.transition(
      work,
      ledger.transition(work, prepared, "authorized", "not_executed"),
      "dispatched",
      "unknown",
    );
    if (recorded) {
      const fixture = await connectFixture(
        "http",
        join(root, "synthetic-receipts", work.runId),
      );
      try {
        const result = await fixture.client.callTool({
          name: "write_sample",
          arguments: { value: "browser synthetic" },
          _meta: {
            "rocky/operation": {
              operationId: dispatched.id,
              intentHash: dispatched.args_hash,
            },
          },
        });
        if (result.isError) throw Error("Fixture receipt creation failed");
      } finally {
        await fixture.close();
      }
    }
    // Simulated crash boundary: domain outcome remains unknown after external effect.
    seeds.push({
      workId: work.id,
      text: work.text,
      recorded,
      runId: work.runId,
    });
  }
  writeFileSync(join(root, "reconciliation-seed.json"), JSON.stringify(seeds));
} finally {
  store.close();
}
