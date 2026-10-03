import { test, expect } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { AIMessage } from "@langchain/core/messages";
import { WorkService } from "../apps/daemon/src/work-service.js";
import { startAgentProvider } from "../fixtures/models/agent-provider.js";
import { createApp } from "../apps/daemon/src/http.js";

test.each([
  "granted",
  "denied",
  "revoked",
  "private",
  "escalated",
  "submitted",
])(
  "native memory boundary: %s",
  async (mode) => {
    const root = await mkdtemp(join(tmpdir(), "rocky-memory-native-"));
    const service = new WorkService(root);
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let delivered = "";
    const provider = await startAgentProvider({
      reply: async (messages) => {
        await held;
        const result = messages.filter((m) => m.type === "tool").at(-1);
        if (result) {
          delivered = String(result.content);
          return new AIMessage("Read inspected");
        }
        return new AIMessage({
          content: "",
          tool_calls: [
            {
              id: "memory-read",
              name: "memory_search",
              args: {
                scope: "user",
                includePrivate: ["private", "escalated"].includes(mode),
                query: "native-marker",
                tokenBudget: 2048,
              },
              type: "tool_call",
            },
          ],
        });
      },
    });
    try {
      for (const privateEntry of [false, true])
        service.memories.save({
          id: randomUUID(),
          requestId: randomUUID(),
          expectedRevision: 0,
          scope: { kind: "user" },
          content:
            "native-marker " +
            (privateEntry ? "PRIVATE_MEMORY" : "PUBLIC_MEMORY"),
          private: privateEntry,
        });
      const connectionId = randomUUID();
      service.models.save({
        id: connectionId,
        requestId: randomUUID(),
        expectedRevision: 0,
        config: {
          name: "Memory fixture",
          provider: "openai-compatible",
          baseUrl: provider.baseUrl,
          modelId: "fixture",
          contextWindowTokens: 65536,
          maxOutputTokens: 256,
        },
      });
      const submission = {
        requestId: randomUUID(),
        text: "Read explicitly granted memory",
        mode: "configured",
        modelSelection: { connectionId, revision: 1 },
        ...(mode === "submitted"
          ? { memoryRead: [{ scope: "user", includePrivate: false }] }
          : {}),
      };
      const work = service.submit(submission);
      const app = createApp(service),
        headers = {
          host: "127.0.0.1:3211",
          "content-type": "application/json",
        };
      const url = "/api/v1/works/" + work.id + "/memory-read-grants";
      const command = {
        requestId: randomUUID(),
        scope: "user",
        includePrivate: mode === "private",
      };
      expect(
        (
          await app.request(url, {
            method: "POST",
            headers,
            body: JSON.stringify(command),
          })
        ).status,
      ).toBe(403);
      if (mode !== "denied" && mode !== "submitted") {
        const { token } = await (
          await app.request("/api/v1/session", { headers })
        ).json();
        const response = await app.request(url, {
          method: "POST",
          headers: { ...headers, "x-rocky-session": token },
          body: JSON.stringify(command),
        });
        expect(response.status).toBe(200);
        const grant = await response.json();
        if (mode === "revoked")
          service.grants.revoke(work.id, grant.id, {
            requestId: randomUUID(),
            expectedRevision: 1,
          });
      }
      if (mode === "submitted") {
        const before = service.grants.list(work.id);
        expect(before).toHaveLength(1);
        service.submit(submission);
        expect(service.grants.list(work.id)).toEqual(before);
      }
      release();
      await expect
        .poll(
          () =>
            ["completed", "failed"].includes(service.store.get(work.id).status),
          { timeout: 15000 },
        )
        .toBe(true);
      if (["granted", "private", "submitted"].includes(mode)) {
        expect(service.store.get(work.id).status).toBe("completed");
        expect(delivered).toContain("PUBLIC_MEMORY");
        if (mode === "private") expect(delivered).toContain("PRIVATE_MEMORY");
        else expect(delivered).not.toContain("PRIVATE_MEMORY");
        expect(JSON.parse(delivered)[0].status).toBe("unverified");
      } else {
        expect(
          service.store
            .events("0", work.id)
            .some(
              (e) =>
                e.payload.kind === "domain" &&
                e.payload.name === "rocky.tool.failed" &&
                e.payload.data.name === "memory_search",
            ),
        ).toBe(true);
        expect(delivered).not.toContain("PUBLIC_MEMORY");
        expect(delivered).not.toContain("PRIVATE_MEMORY");
      }
      expect(() =>
        service.memories.readForWork(service.store.get(work.id), {
          scope: "user",
        }),
      ).toThrow();
    } finally {
      release();
      await service.close();
      await provider.close();
      await rm(root, { recursive: true, force: true });
    }
  },
  20000,
);
