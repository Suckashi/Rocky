import { test, expect } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { AIMessage } from "@langchain/core/messages";
import { WorkService } from "../apps/daemon/src/work-service.js";
import { workSchema } from "../packages/contracts/src/index.js";
import { startAgentProvider } from "../fixtures/models/agent-provider.js";
test.each(["result", "text-only", "budget"])(
  "daemon reflection admission and terminal evidence: %s",
  async (mode) => {
    const root = await mkdtemp(join(tmpdir(), "rocky-reflection-service-")),
      service = new WorkService(root);
    let calls = 0;
    const provider = await startAgentProvider({
      reply: async () => {
        calls++;
        if (mode === "text-only" || (mode === "result" && calls > 1))
          return new AIMessage("Assessment finished");
        return new AIMessage({
          content: "",
          tool_calls: [
            {
              id: randomUUID(),
              name:
                mode === "budget"
                  ? "read_learning_episode"
                  : "mark_no_learning",
              args:
                mode === "budget"
                  ? {}
                  : { reason: "Insufficient independent evidence" },
              type: "tool_call",
            },
          ],
        });
      },
    });
    try {
      const connectionId = randomUUID();
      service.models.save({
        id: connectionId,
        requestId: randomUUID(),
        expectedRevision: 0,
        config: {
          name: "Reflection fixture",
          provider: "openai-compatible",
          baseUrl: provider.baseUrl,
          modelId: "scripted",
          contextWindowTokens: 8192,
          maxOutputTokens: 256,
        },
      });
      const source = workSchema.parse({
        id: randomUUID(),
        runId: randomUUID(),
        executionSessionId: randomUUID(),
        requestId: randomUUID(),
        text: "Synthetic verified source",
        transport: "http",
        mode: "configured",
        modelSelection: { connectionId, revision: 1 },
        runMode: "normal",
        status: "completed",
        revision: 1,
        answer: "Fixture",
        createdAt: new Date().toISOString(),
      });
      service.store.add(source, source.id);
      const event = service.store.event(source, "rocky.tool.completed", {
        name: "fixture_read",
      });
      service.store.event(source, "rocky.work.updated", { work: source });
      service.store.dispatchOutbox(() => {});
      service.learning.saveWorkConsent(source.id, {
        requestId: randomUUID(),
        expectedRevision: 0,
        private: false,
        excluded: false,
        sourceReuseAllowed: true,
      });
      const episode = service.learning.createEpisode({
        requestId: randomUUID(),
        workId: source.id,
        expectedPolicyRevision: 0,
        expectedConsentRevision: 1,
        trigger: "manual_request",
        goal: "Assess procedure",
        constraints: [],
        corrections: [],
        verification: [],
        failuresAndRepairs: [],
        preconditions: [],
        evidenceEventIds: [event.id],
      });
      const command = {
        requestId: randomUUID(),
        binding: {
          episodeId: episode.id,
          episodeRevision: 2,
          episodeHash: episode.contentHash,
        },
        modelSelection: { connectionId, revision: 1 },
        modelBudget: { maxCalls: 2 },
      };
      expect(() => service.reflect(command)).toThrow("approved");
      service.learning.reviewEpisode(episode.id, {
        requestId: randomUUID(),
        expectedRevision: 1,
        contentHash: episode.contentHash,
        decision: "approve",
      });
      const work = service.reflect(command);
      expect(work.runMode).toBe("reflection");
      expect(service.reflect(command).id).toBe(work.id);
      expect(() =>
        service.reflect({ ...command, modelBudget: { maxCalls: 3 } }),
      ).toThrow("changed");
      await expect
        .poll(() => service.store.get(work.id).status, { timeout: 15000 })
        .toBe(mode === "result" ? "completed" : "failed");
      const final = service.store.get(work.id);
      if (mode === "text-only")
        expect(final.error).toContain("without a persisted");
      if (mode === "budget") expect(calls).toBe(2);
      const outputs = service.store.db
        .prepare(
          "SELECT data FROM learning_reflection_outputs WHERE json_extract(data,'$.execution.runId')=?",
        )
        .all(work.runId);
      expect(outputs).toHaveLength(mode === "result" ? 1 : 0);
      expect(
        service.modelBudgets.snapshot(work.runId).calls,
      ).toBeLessThanOrEqual(2);
    } finally {
      await service.close();
      await provider.close();
      await rm(root, { recursive: true, force: true });
    }
  },
);
