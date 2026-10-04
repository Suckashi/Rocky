import { test, expect } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { AIMessage } from "@langchain/core/messages";
import { WorkService } from "../apps/daemon/src/work-service.js";
import { createApp } from "../apps/daemon/src/http.js";
import { workSchema } from "../packages/contracts/src/index.js";
import { startAgentProvider } from "../fixtures/models/agent-provider.js";
test.each([
  "result",
  "text-only",
  "budget",
  "withdraw",
  "withdraw-output",
  "stop",
])("daemon reflection admission and terminal evidence: %s", async (mode) => {
  const root = await mkdtemp(join(tmpdir(), "rocky-reflection-service-")),
    service = new WorkService(root);
  let calls = 0;
  let sourceId = "";
  const provider = await startAgentProvider({
    hold: mode === "stop",
    reply: async () => {
      calls++;
      if (
        (mode === "withdraw" && calls === 1) ||
        (mode === "withdraw-output" && calls === 2)
      )
        service.learning.saveWorkConsent(sourceId, {
          requestId: randomUUID(),
          expectedRevision: 1,
          private: true,
          excluded: true,
          sourceReuseAllowed: false,
        });
      if (
        mode === "text-only" ||
        (["result", "withdraw-output"].includes(mode) && calls > 1)
      )
        return new AIMessage("Assessment finished");
      return new AIMessage({
        content: "",
        tool_calls: [
          {
            id: randomUUID(),
            name:
              mode === "budget" ? "read_learning_episode" : "mark_no_learning",
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
    sourceId = source.id;
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
    const app = createApp(service);
    const headers = {
      host: "127.0.0.1:3211",
      "content-type": "application/json",
    };
    expect(
      (
        await app.request("/api/v1/learning/reflections", {
          method: "POST",
          headers,
          body: JSON.stringify(command),
        })
      ).status,
    ).toBe(403);
    const session = (await (
      await app.request("/api/v1/session", { headers })
    ).json()) as { token: string };
    const response = await app.request("/api/v1/learning/reflections", {
      method: "POST",
      headers: { ...headers, "x-rocky-session": session.token },
      body: JSON.stringify(command),
    });
    expect(response.status).toBe(200);
    const work = workSchema.parse(await response.json());
    expect(work.runMode).toBe("reflection");
    expect(service.reflect(command).id).toBe(work.id);
    expect(() =>
      service.reflect({ ...command, modelBudget: { maxCalls: 3 } }),
    ).toThrow("changed");
    if (mode === "stop") {
      await expect
        .poll(() => provider.requests.length, { timeout: 15000 })
        .toBe(1);
      const current = service.store.get(work.id);
      const stop = {
        requestId: randomUUID(),
        runId: current.runId,
        executionSessionId: current.executionSessionId,
        expectedRevision: current.revision,
      };
      expect(service.stop(work.id, stop).status).toBe("cancelled");
      expect(service.stop(work.id, stop).status).toBe("cancelled");
    }
    await expect
      .poll(() => service.store.get(work.id).status, { timeout: 15000 })
      .toBe(
        mode === "result"
          ? "completed"
          : mode === "stop"
            ? "cancelled"
            : "failed",
      );
    const final = service.store.get(work.id);
    if (mode === "text-only")
      expect(final.error).toContain("without a persisted");
    if (mode === "budget") expect(calls).toBe(2);
    const outputs = service.store.db
      .prepare(
        "SELECT data FROM learning_reflection_outputs WHERE json_extract(data,'$.execution.runId')=?",
      )
      .all(work.runId);
    expect(outputs).toHaveLength(
      ["result", "withdraw-output"].includes(mode) ? 1 : 0,
    );
    if (mode === "withdraw-output") {
      const output = JSON.parse(String(outputs[0]!.data));
      expect(output.status).toBe("withdrawn");
      expect(output).not.toHaveProperty("payload");
    }
    if (mode.startsWith("withdraw")) expect(final.error).toContain("consent");
    const resultsResponse = await app.request(
      "/api/v1/learning/reflections/" + work.id + "/results",
      { headers },
    );
    expect(resultsResponse.status).toBe(
      mode.startsWith("withdraw") ? 403 : 200,
    );
    if (!mode.startsWith("withdraw")) {
      const view = (await resultsResponse.json()) as {
        outputs: unknown[];
        status: string;
        nextCursor: string | null;
      };
      expect(view.status).toBe(final.status);
      expect(view.outputs).toHaveLength(mode === "result" ? 1 : 0);
      expect(view.nextCursor).toBeNull();
    }
    expect(
      (
        await app.request(
          "/api/v1/learning/reflections/" + source.id + "/results",
          { headers },
        )
      ).status,
    ).toBe(422);
    if (mode === "result") {
      expect(
        (
          await app.request(
            "/api/v1/learning/reflections/" + work.id + "/results?before=bad",
            { headers },
          )
        ).status,
      ).toBe(422);
      const stored = JSON.parse(String(outputs[0]!.data));
      for (let i = 0; i < 21; i++) {
        const id = randomUUID();
        service.store.db
          .prepare("INSERT INTO learning_reflection_outputs VALUES(?,?,?,?)")
          .run(id, id, "fixture", JSON.stringify({ ...stored, id }));
      }
      const first = service.reflection.results(work.id) as {
        outputs: { id: string }[];
        nextCursor: string;
      };
      const second = service.reflection.results(work.id, first.nextCursor) as {
        outputs: { id: string }[];
        nextCursor: null;
      };
      expect(first.outputs).toHaveLength(20);
      expect(second.outputs).toHaveLength(2);
      expect(second.nextCursor).toBeNull();
      expect(
        new Set([...first.outputs, ...second.outputs].map((item) => item.id))
          .size,
      ).toBe(22);
    }
    if (mode === "stop") expect(provider.requests).toHaveLength(1);
    expect(service.reflect(command).id).toBe(work.id);
    expect(service.modelBudgets.snapshot(work.runId).calls).toBeLessThanOrEqual(
      2,
    );
  } finally {
    await service.close();
    await provider.close();
    await rm(root, { recursive: true, force: true });
  }
});
