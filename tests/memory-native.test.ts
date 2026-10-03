import { test, expect } from "vitest";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { AIMessage } from "@langchain/core/messages";
import { WorkService } from "../apps/daemon/src/work-service.js";
import { startAgentProvider } from "../fixtures/models/agent-provider.js";
import { createApp } from "../apps/daemon/src/http.js";
import { Tiktoken } from "js-tiktoken/lite";
import cl100k from "js-tiktoken/ranks/cl100k_base";

test.each([
  "granted",
  "denied",
  "revoked",
  "private",
  "escalated",
  "submitted",
  "budget",
  "empty",
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
                query:
                  mode === "empty" ? "no-matching-memory" : "native-marker",
                tokenBudget: mode === "budget" ? 128 : 2048,
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
            (privateEntry ? "PRIVATE_MEMORY" : "PUBLIC_MEMORY") +
            (mode === "budget" ? "字".repeat(300) : ""),
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
      if (
        ["granted", "private", "submitted", "budget", "empty"].includes(mode)
      ) {
        expect(service.store.get(work.id).status).toBe("completed");
        const payload = JSON.parse(delivered);
        expect(
          new Tiktoken(cl100k).encode(delivered, [], []).length,
        ).toBeLessThanOrEqual(payload.tokenBudget);
        expect(payload.untrustedData).toBe(true);
        expect(payload.encoding).toBe("cl100k_base");
        if (["budget", "empty"].includes(mode)) {
          expect(payload.items).toEqual([]);
          expect(payload.truncated).toBe(mode === "budget");
        } else {
          expect(delivered).toContain("PUBLIC_MEMORY");
          if (mode === "private") expect(delivered).toContain("PRIVATE_MEMORY");
          else expect(delivered).not.toContain("PRIVATE_MEMORY");
          expect(payload.items[0].status).toBe("unverified");
          expect(payload.truncated).toBe(false);
        }
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

test.each(["project", "task", "child", "replay", "evaluation"])(
  "native memory scope isolation: %s",
  async (mode) => {
    const root = await mkdtemp(join(tmpdir(), "rocky-memory-isolation-"));
    const service = new WorkService(join(root, "data"));
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const received: string[] = [];
    let childAttempted = false;
    const provider = await startAgentProvider({
      reply: async (messages) => {
        await held;
        const child = messages.some(
          (m) =>
            m.type === "human" && String(m.content) === "CHILD_MEMORY_ATTEMPT",
        );
        const result = messages.filter((m) => m.type === "tool").at(-1);
        if (result) {
          received.push(String(result.content));
          return new AIMessage("Evidence checked");
        }
        if (child) childAttempted = true;
        return new AIMessage({
          content: "",
          tool_calls: [
            {
              id: child ? "child-memory" : "root-memory",
              name: mode === "child" && !child ? "task" : "memory_search",
              args:
                mode === "child" && !child
                  ? {
                      subagent_type: "general-purpose",
                      description: "CHILD_MEMORY_ATTEMPT",
                    }
                  : {
                      scope:
                        mode === "project"
                          ? "project"
                          : mode === "task"
                            ? "task"
                            : "user",
                      query: "scope-secret",
                      includePrivate: false,
                    },
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
          name: "Isolation fixture",
          provider: "openai-compatible",
          baseUrl: provider.baseUrl,
          modelId: "fixture",
          contextWindowTokens: 65536,
          maxOutputTokens: 256,
        },
      });
      const roots = [join(root, "one"), join(root, "two")];
      const workspaces = [];
      for (const path of roots) {
        await mkdir(path);
        workspaces.push(
          await service.workspaces.save({
            id: randomUUID(),
            requestId: randomUUID(),
            expectedRevision: 0,
            name: path,
            root: path,
          }),
        );
      }
      const scope =
        mode === "project" ? "project" : mode === "task" ? "task" : "user";
      const submission = {
        requestId: randomUUID(),
        text: "Scope isolation",
        mode: "configured",
        modelSelection: { connectionId, revision: 1 },
        memoryRead: [{ scope, includePrivate: false }],
        ...(mode === "project"
          ? { workspaceId: workspaces[0]!.id, workspaceRevision: 1 }
          : {}),
      };
      if (mode === "evaluation") {
        const before = service.store.list().length;
        expect(() => service.submit(submission, "evaluation")).toThrow(
          "normal configured Work",
        );
        expect(service.store.list()).toHaveLength(before);
        expect(
          service.store.db
            .prepare("SELECT COUNT(*) AS n FROM capability_grants")
            .get(),
        ).toMatchObject({ n: 0 });
        return;
      }
      const work = service.submit(submission);
      const actualScope =
        scope === "user"
          ? { kind: "user" }
          : {
              kind: scope,
              id: scope === "project" ? workspaces[0]!.id : work.id,
            };
      const otherWork =
        mode === "task"
          ? service.submit({
              ...submission,
              requestId: randomUUID(),
              kind: "background",
              text: "Other task without inherited memory grant",
              memoryRead: [],
            })
          : undefined;
      if (otherWork) {
        service.memories.save({
          id: randomUUID(),
          requestId: randomUUID(),
          expectedRevision: 0,
          scope: { kind: "task", id: otherWork.id },
          content: "scope-secret WRONG_TASK",
          private: false,
        });
        expect(service.grants.list(otherWork.id)).toHaveLength(0);
      }
      service.memories.save({
        id: randomUUID(),
        requestId: randomUUID(),
        expectedRevision: 0,
        scope: actualScope,
        content: "scope-secret EXPECTED_SCOPE",
        private: false,
      });
      service.memories.save({
        id: randomUUID(),
        requestId: randomUUID(),
        expectedRevision: 0,
        scope: { kind: "project", id: workspaces[1]!.id },
        content: "scope-secret WRONG_PROJECT",
        private: false,
      });
      if (scope !== "user")
        service.memories.save({
          id: randomUUID(),
          requestId: randomUUID(),
          expectedRevision: 0,
          scope: { kind: "user" },
          content: "scope-secret WRONG_USER",
          private: false,
        });
      if (mode === "replay") {
        const grant = service.grants.list(work.id)[0]!;
        service.grants.revoke(work.id, grant.id, {
          requestId: randomUUID(),
          expectedRevision: 1,
        });
        service.submit(submission);
        expect(service.grants.list(work.id)).toMatchObject([
          { id: grant.id, revoked: true },
        ]);
      }
      release();
      await expect
        .poll(
          () =>
            ["completed", "failed"].includes(service.store.get(work.id).status),
          { timeout: 15000 },
        )
        .toBe(true);
      const delivered = received.join(" ");
      expect(delivered).not.toContain("WRONG_PROJECT");
      expect(delivered).not.toContain("WRONG_USER");
      expect(delivered).not.toContain("WRONG_TASK");
      if (otherWork) {
        await expect
          .poll(
            () =>
              ["completed", "failed"].includes(
                service.store.get(otherWork.id).status,
              ),
            { timeout: 15000 },
          )
          .toBe(true);
        expect(
          service.store
            .events("0", otherWork.id)
            .some(
              (e) =>
                e.payload.kind === "domain" &&
                e.payload.name === "rocky.tool.failed" &&
                e.payload.data.name === "memory_search",
            ),
        ).toBe(true);
        expect(received.join(" ")).not.toContain("WRONG_TASK");
      }
      if (["project", "task"].includes(mode))
        expect(delivered).toContain("EXPECTED_SCOPE");
      else expect(delivered).not.toContain("EXPECTED_SCOPE");
      if (mode === "child") {
        expect(childAttempted).toBe(true);
        expect(
          service.store
            .events("0", work.id)
            .some(
              (e) =>
                e.payload.kind === "domain" &&
                e.payload.name === "rocky.subagent.started",
            ),
        ).toBe(true);
      }
    } finally {
      release();
      await service.close();
      await provider.close();
      await rm(root, { recursive: true, force: true });
    }
  },
  20000,
);
