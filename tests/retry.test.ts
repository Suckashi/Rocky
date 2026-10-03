import { test, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { AIMessage } from "@langchain/core/messages";
import { FixtureWorkService as WorkService } from "./support/fixture-work-service.js";
import { ConversationStore } from "../apps/daemon/src/conversation-store.js";
import { OperationReconciler } from "../apps/daemon/src/operation-reconciler.js";
import { startAgentProvider } from "../fixtures/models/agent-provider.js";
import { workSchema, type Work } from "../packages/contracts/src/index.js";
const command = (w: Work) => ({
  requestId: randomUUID(),
  runId: w.runId,
  executionSessionId: w.executionSessionId,
  expectedRevision: w.revision,
  effectRefs: [],
});
async function setup(tool = false) {
  const provider = await startAgentProvider({
      reply: async () =>
        tool
          ? new AIMessage({
              content: "",
              tool_calls: [
                {
                  id: "retry-write",
                  name: "write_sample",
                  args: { value: "prior value" },
                  type: "tool_call",
                },
              ],
            })
          : new AIMessage("observed result"),
    }),
    root = mkdtempSync(join(tmpdir(), "rocky-retry-")),
    service = new WorkService(root),
    id = randomUUID();
  service.models.save({
    requestId: randomUUID(),
    id,
    expectedRevision: 0,
    config: {
      name: "retry fixture",
      provider: "openai-compatible",
      baseUrl: provider.baseUrl,
      modelId: "retry",
      contextWindowTokens: 65536,
      maxOutputTokens: 128,
    },
  });
  return {
    provider,
    root,
    service,
    id,
    selection: { connectionId: id, revision: 1 },
    close: async () => {
      await service.close();
      await provider.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}
test("retry creates new durable Work/run/session/budget, keeps source immutable and survives restart idempotently", async () => {
  const f = await setup();
  let current = f.service;
  try {
    const source = f.service.submit({
      requestId: randomUUID(),
      text: "observe",
      kind: "background",
      mode: "configured",
      transport: "http",
      modelSelection: f.selection,
    });
    expect(() => current.retry(source.id, command(source))).toThrow("inactive");
    await expect
      .poll(() => current.store.get(source.id).status, { timeout: 10000 })
      .toBe("completed");
    const original = current.store.get(source.id),
      input = command(original);
    expect(() =>
      current.retry(source.id, { ...input, runId: randomUUID() }),
    ).toThrow("changed");
    const retry = current.retry(source.id, input);
    expect(retry.retryOf).toBe(source.id);
    expect(retry.id).not.toBe(source.id);
    expect(retry.runId).not.toBe(source.runId);
    expect(retry.executionSessionId).not.toBe(source.executionSessionId);
    expect(
      new ConversationStore(current.store).session(retry.id)
        .sourceGraphThreadId,
    ).toBeUndefined();
    expect(current.retry(source.id, input).id).toBe(retry.id);
    expect(() =>
      current.retry(source.id, {
        ...input,
        expectedRevision: input.expectedRevision + 1,
      }),
    ).toThrow("changed");
    await expect
      .poll(() => current.store.get(retry.id).status, { timeout: 10000 })
      .toBe("completed");
    expect(current.store.get(source.id)).toEqual(original);
    expect(current.modelBudgets.snapshot(source.runId).calls).toBe(1);
    expect(current.modelBudgets.snapshot(retry.runId).calls).toBe(1);
    expect(JSON.stringify(f.provider.requests.at(-1))).toContain(
      "Prior effect receipts",
    );
    await current.close();
    current = new WorkService(f.root);
    expect(current.retry(source.id, input).id).toBe(retry.id);
    expect(current.store.get(source.id)).toEqual(original);
  } finally {
    await current.close();
    await f.provider.close();
    rmSync(f.root, { recursive: true, force: true });
  }
});
for (const outcome of ["succeeded", "failed_known_no_effect"] as const)
  test(
    "retry rejects unknown effects and requires exact reconciliation refs: " +
      outcome,
    async () => {
      const f = await setup(true);
      try {
        const source = workSchema.parse({
          id: randomUUID(),
          runId: randomUUID(),
          executionSessionId: randomUUID(),
          requestId: randomUUID(),
          text: "continue safely",
          transport: "http",
          mode: "configured",
          modelSelection: f.selection,
          kind: "background",
          runMode: "normal",
          status: "running",
          revision: 1,
          answer: "",
          createdAt: new Date().toISOString(),
        });
        f.service.store.add(source, "manual test source");
        const prepared = f.service.operations.prepare(
            source,
            "old-write",
            "write_sample",
            { value: "prior value" },
            "fixture fingerprint",
          ),
          dispatched = f.service.operations.transition(
            source,
            f.service.operations.transition(
              source,
              prepared,
              "authorized",
              "not_executed",
            ),
            "dispatched",
            "unknown",
          );
        const blocked = { ...source, status: "blocked" as const, revision: 2 };
        f.service.store.save(blocked, 1);
        const input = command(blocked);
        expect(() => f.service.retry(source.id, input)).toThrow(
          "Reconcile unknown",
        );
        const receipt = await new OperationReconciler(
          f.service.store,
        ).reconcile(
          source.id,
          {
            requestId: randomUUID(),
            operationId: dispatched.id,
            expectedRevision: dispatched.revision,
          },
          async () => ({
            operationId: dispatched.id,
            intentHash: dispatched.args_hash,
            outcome,
            result:
              outcome === "succeeded" ? '{"observed":"prior result"}' : null,
            evidenceRef: randomUUID(),
            observedAt: new Date().toISOString(),
          }),
          new AbortController().signal,
        );
        expect(() => f.service.retry(source.id, input)).toThrow(
          "Confirm the exact",
        );
        const refs = [
          {
            operationId: receipt.operationId,
            expectedRevision: receipt.operationRevision,
            reconciliationReceiptId: receipt.id,
          },
        ];
        expect(() =>
          f.service.retry(source.id, {
            ...input,
            effectRefs: [{ ...refs[0], reconciliationReceiptId: randomUUID() }],
          }),
        ).toThrow("Reconciliation receipt");
        const retry = f.service.retry(source.id, {
          ...input,
          effectRefs: refs,
        });
        await expect
          .poll(() => f.service.store.get(retry.id).status, { timeout: 10000 })
          .toBe(outcome === "succeeded" ? "failed" : "waiting_approval");
        expect(f.service.store.get(source.id)).toEqual(blocked);
        expect(f.service.operations.get(dispatched.id)?.outcome).toBe(outcome);
        expect(JSON.stringify(f.provider.requests.at(-1))).toContain(
          receipt.operationId,
        );
        if (outcome === "succeeded") {
          expect(f.service.store.get(retry.id).error).toContain(
            "cannot repeat",
          );
          expect(f.service.operations.list(retry.id)).toEqual([]);
        } else {
          const pending = f.service.store.get(retry.id);
          expect(pending.approval?.operationId).not.toBe(dispatched.id);
          expect(pending.approval?.status).toBe("pending");
          f.service.stop(retry.id, {
            requestId: randomUUID(),
            runId: pending.runId,
            executionSessionId: pending.executionSessionId,
            expectedRevision: pending.revision,
          });
        }
      } finally {
        await f.close();
      }
    },
  );
