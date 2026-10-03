import { test, expect, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { AIMessage } from "@langchain/core/messages";
import { WorkService } from "../apps/daemon/src/work-service.js";
import { startAgentProvider } from "../fixtures/models/agent-provider.js";

test.each(["approve", "reject", "locked", "race", "rollback", "update"])(
  "native memory write exact approval: %s",
  async (mode) => {
    const root = await mkdtemp(join(tmpdir(), "rocky-memory-write-"));
    const service = new WorkService(root),
      id = randomUUID();
    const provider = await startAgentProvider({
      reply: async (messages) =>
        messages.filter((m) => m.type === "tool").length >=
        (mode === "update" ? 2 : 1)
          ? new AIMessage("Memory result inspected")
          : new AIMessage({
              content: "",
              tool_calls: [
                {
                  id:
                    "remember-" +
                    messages.filter((m) => m.type === "tool").length,
                  name: "memory_write",
                  args: {
                    id,
                    expectedRevision:
                      mode === "locked"
                        ? 1
                        : mode === "update"
                          ? messages.filter((m) => m.type === "tool").length
                          : 0,
                    scope: "user",
                    content:
                      "Model proposed preference" +
                      (mode === "update" &&
                      messages.some((m) => m.type === "tool")
                        ? " updated"
                        : ""),
                    private: true,
                    sources: [],
                  },
                  type: "tool_call",
                },
              ],
            }),
    });
    try {
      const ownerSave = () =>
        service.memories.save({
          requestId: randomUUID(),
          id,
          expectedRevision: 0,
          scope: { kind: "user" },
          content: "OWNER_MUST_REMAIN",
        });
      if (mode === "locked") ownerSave();
      const connectionId = randomUUID();
      service.models.save({
        id: connectionId,
        requestId: randomUUID(),
        expectedRevision: 0,
        config: {
          name: "Memory write fixture",
          provider: "openai-compatible",
          baseUrl: provider.baseUrl,
          modelId: "fixture",
          contextWindowTokens: 65536,
          maxOutputTokens: 256,
        },
      });
      const work = service.submit({
        requestId: randomUUID(),
        text: "Remember proposal",
        mode: "configured",
        modelSelection: { connectionId, revision: 1 },
      });
      await expect
        .poll(() => service.store.get(work.id).status, { timeout: 15000 })
        .toBe(mode === "locked" ? "failed" : "waiting_approval");
      if (mode === "locked") {
        expect(service.memories.get(id).content).toBe("OWNER_MUST_REMAIN");
        return;
      }
      expect(() => service.memories.get(id)).toThrow("not found");
      if (mode === "race") ownerSave();
      if (mode === "rollback") {
        const save = service.memories.saveModel.bind(service.memories);
        vi.spyOn(service.memories, "saveModel").mockImplementationOnce(
          (...args) => {
            save(...args);
            throw Error("Injected atomic write failure");
          },
        );
      }
      const approval = service.store.get(work.id).approval!;
      expect(approval.tool).toBe("memory_write");
      const previewInput = {
        expectedRevision: approval.revision,
        intentFingerprint: approval.intentFingerprint,
      };
      if (mode === "race")
        expect(() =>
          service.previewMemory(approval.id, previewInput),
        ).toThrow();
      else {
        const preview = service.previewMemory(approval.id, previewInput);
        expect(preview).toMatchObject({
          memoryId: id,
          revision: 0,
          removedLines: 0,
          addedLines: 1,
          previousPrivate: null,
          nextPrivate: true,
        });
        expect(preview.rows[0]?.text).toContain("Model proposed preference");
        expect(() =>
          service.previewMemory(approval.id, {
            ...previewInput,
            expectedRevision: 99,
          }),
        ).toThrow();
      }
      service.decide(work.id, {
        requestId: randomUUID(),
        expectedRevision: approval.revision,
        intentFingerprint: approval.intentFingerprint,
        decision: mode === "reject" ? "reject" : "approve",
      });
      if (mode === "update") {
        await expect
          .poll(
            () => service.store.get(work.id).approval?.args.expectedRevision,
            { timeout: 15000 },
          )
          .toBe(1);
        const next = service.store.get(work.id).approval!;
        const changes = service.previewMemory(next.id, {
          expectedRevision: next.revision,
          intentFingerprint: next.intentFingerprint,
        });
        expect(changes).toMatchObject({
          removedLines: 1,
          addedLines: 1,
          revision: 1,
        });
        expect(
          changes.rows.filter((row) => row.kind === "add")[0]?.text,
        ).toContain("updated");
        service.decide(work.id, {
          requestId: randomUUID(),
          expectedRevision: next.revision,
          intentFingerprint: next.intentFingerprint,
          decision: "approve",
        });
      }
      await expect
        .poll(
          () =>
            ["completed", "failed"].includes(service.store.get(work.id).status),
          { timeout: 15000 },
        )
        .toBe(true);
      expect(() => service.previewMemory(approval.id, previewInput)).toThrow();
      if (mode === "approve" || mode === "update") {
        expect(service.memories.get(id)).toMatchObject({
          content:
            "Model proposed preference" + (mode === "update" ? " updated" : ""),
          source: "model",
          sourceWorkId: work.id,
          sourceRunId: work.runId,
          locked: false,
          userEdited: false,
          private: true,
          status: "unverified",
          revision: mode === "update" ? 2 : 1,
        });
        expect(service.operations.list(work.id)[0]).toMatchObject({
          outcome: "succeeded",
        });
        service.memories.save({
          requestId: randomUUID(),
          id,
          expectedRevision: mode === "update" ? 2 : 1,
          scope: { kind: "user" },
          content: "Owner correction",
        });
        expect(service.memories.get(id)).toMatchObject({
          source: "owner",
          locked: true,
          userEdited: true,
          revision: mode === "update" ? 3 : 2,
        });
      } else if (mode === "race")
        expect(service.memories.get(id).content).toBe("OWNER_MUST_REMAIN");
      else {
        expect(() => service.memories.get(id)).toThrow("not found");
        expect(service.operations.list(work.id)[0]?.outcome).toBe(
          mode === "reject" ? "not_executed" : "failed_known_no_effect",
        );
        expect(
          service.store.db.prepare("SELECT * FROM memory_receipts").all(),
        ).toHaveLength(0);
      }
    } finally {
      await service.close();
      await provider.close();
      await rm(root, { recursive: true, force: true });
    }
  },
  20000,
);
