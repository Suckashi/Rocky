import { test, expect } from "vitest";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { AIMessage } from "@langchain/core/messages";
import { WorkService } from "../apps/daemon/src/work-service.js";
import { createApp } from "../apps/daemon/src/http.js";
import { startAgentProvider } from "../fixtures/models/agent-provider.js";

test.each(["approve", "reject", "child", "steer"] as const)(
  "configured Work native command: %s",
  async (mode) => {
    const base = await mkdtemp(join(tmpdir(), "rocky-native-work-")),
      root = join(base, "project");
    await mkdir(root);
    const service = new WorkService(join(base, "data"));
    const provider = await startAgentProvider({
      reply: async (messages) => {
        const last = messages.filter((m) => m.type === "tool").at(-1);
        if (last)
          return new AIMessage(
            "Observed tool receipt: " + String(last.content),
          );
        const child = messages.some(
          (m) => m.type === "human" && m.content === "CHILD_COMMAND",
        );
        return new AIMessage({
          content: "",
          tool_calls: [
            {
              id: child ? "child-command" : "root-command",
              name: mode === "child" && !child ? "task" : "workspace_command",
              args:
                mode === "child" && !child
                  ? {
                      subagent_type: "general-purpose",
                      description: "CHILD_COMMAND",
                    }
                  : {
                      executable: process.execPath,
                      args: [
                        "-e",
                        "require('node:fs').appendFileSync('actual-command.txt','confirmed\\n');console.log('process returned')",
                      ],
                      timeoutMs: 5000,
                      maxOutputBytes: 4096,
                    },
              type: "tool_call",
            },
          ],
        });
      },
    });
    try {
      const workspace = await service.workspaces.save({
        id: randomUUID(),
        requestId: randomUUID(),
        expectedRevision: 0,
        name: "Native Work",
        root,
      });
      const connectionId = randomUUID();
      service.models.save({
        id: connectionId,
        requestId: randomUUID(),
        expectedRevision: 0,
        config: {
          name: "Local native fixture",
          provider: "openai-compatible",
          baseUrl: provider.baseUrl,
          modelId: "fixture",
          contextWindowTokens: 65536,
          maxOutputTokens: 256,
        },
      });
      const work = service.submit({
        requestId: randomUUID(),
        text: "RUN_NATIVE_COMMAND",
        mode: "configured",
        modelSelection: { connectionId, revision: 1 },
        workspaceId: workspace.id,
        workspaceRevision: 1,
        workspaceRead: false,
      });
      await expect
        .poll(() => service.store.get(work.id).status, { timeout: 15000 })
        .toBe(mode === "child" ? "failed" : "waiting_approval");
      if (mode === "child") {
        expect(service.store.get(work.id).error).toContain(
          "Native children cannot request command execution",
        );
        await expect(
          readFile(join(root, "actual-command.txt")),
        ).rejects.toThrow();
        expect(
          service.operations
            .list(work.id)
            .some((o) => o.tool === "workspace_command"),
        ).toBe(false);
        return;
      }
      const pending = service.store.get(work.id),
        approval = pending.approval!;
      if (mode === "steer") {
        const correction = {
          requestId: randomUUID(),
          runId: pending.runId,
          executionSessionId: pending.executionSessionId,
          expectedRevision: pending.revision,
          text: "Do not run the command. Explain only.",
        };
        service.steer(work.id, correction);
        expect(service.store.get(work.id).approval?.status).toBe("expired");
        expect(service.operations.get(approval.operationId!)?.outcome).toBe(
          "not_executed",
        );
        expect(() =>
          service.decide(work.id, {
            requestId: randomUUID(),
            expectedRevision: approval.revision,
            intentFingerprint: approval.intentFingerprint,
            decision: "approve",
          }),
        ).toThrow();
        await expect
          .poll(() => service.store.get(work.id).status, { timeout: 15000 })
          .toBe("completed");
        await expect(
          readFile(join(root, "actual-command.txt")),
        ).rejects.toThrow();
        expect(() =>
          service.operations.assertNoRefusedEffects(service.store.get(work.id)),
        ).not.toThrow();
        return;
      }
      expect(approval.tool).toBe("workspace_command");
      expect(approval.targetPreview).toBe(process.execPath);
      await expect(
        readFile(join(root, "actual-command.txt")),
      ).rejects.toThrow();
      const app = createApp(service),
        url = "/api/v1/approvals/" + approval.id + "/decision";
      const headers = {
        host: "127.0.0.1:3211",
        "content-type": "application/json",
      };
      const command = {
        requestId: randomUUID(),
        expectedRevision: approval.revision,
        intentFingerprint: approval.intentFingerprint,
        decision: mode === "approve" ? "approve" : "reject",
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
      const session = (await (
        await app.request("/api/v1/session", { headers })
      ).json()) as { token: string };
      const response = await app.request(url, {
        method: "POST",
        headers: { ...headers, "x-rocky-session": session.token },
        body: JSON.stringify(command),
      });
      expect(response.status).toBe(200);
      await expect
        .poll(
          () =>
            ["completed", "failed", "blocked"].includes(
              service.store.get(work.id).status,
            ),
          { timeout: 15000 },
        )
        .toBe(true);
      if (mode === "approve") {
        expect(
          service.store.get(work.id).status,
          service.store.get(work.id).error,
        ).toBe("completed");
        expect(await readFile(join(root, "actual-command.txt"), "utf8")).toBe(
          "confirmed\n",
        );
        expect(service.operations.list(work.id)).toEqual([
          expect.objectContaining({
            tool: "workspace_command",
            phase: "settled",
            outcome: "succeeded",
          }),
        ]);
        expect(
          JSON.parse(service.operations.get(approval.operationId!)!.result!),
        ).toMatchObject({ reason: "exited", exitCode: 0, isolation: "none" });
        expect(service.operations.commandReceipts(work.id)).toEqual([
          expect.objectContaining({
            workId: work.id,
            runId: work.runId,
            id: approval.operationId,
            result: expect.objectContaining({
              stdout: "process returned\n",
              exitCode: 0,
            }),
          }),
        ]);
        expect(
          (
            await app.request(url, {
              method: "POST",
              headers: { ...headers, "x-rocky-session": session.token },
              body: JSON.stringify(command),
            })
          ).status,
        ).toBe(200);
        expect(await readFile(join(root, "actual-command.txt"), "utf8")).toBe(
          "confirmed\n",
        );
      } else {
        expect(() =>
          service.operations.assertNoRefusedEffects(service.store.get(work.id)),
        ).toThrow("owner rejected");
        await expect(
          readFile(join(root, "actual-command.txt")),
        ).rejects.toThrow();
        expect(service.operations.list(work.id)).toEqual([
          expect.objectContaining({ outcome: "not_executed" }),
        ]);
      }
    } finally {
      await service.close();
      await provider.close();
      await rm(base, { recursive: true, force: true });
    }
  },
  30000,
);
