import { test, expect, vi } from "vitest";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  stat,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { AIMessage } from "@langchain/core/messages";
import { WorkService } from "../apps/daemon/src/work-service.js";
import { startAgentProvider } from "../fixtures/models/agent-provider.js";
const exec = promisify(execFile);
test.each([
  "approve",
  "reject",
  "stale",
  "child",
  "cancel",
  "registration-failure",
] as const)(
  "native worktree exact consent: %s",
  async (mode) => {
    const base = await mkdtemp(join(tmpdir(), "rocky-worktree-native-")),
      root = join(base, "source");
    await mkdir(root);
    const env = {
      ...process.env,
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null",
    };
    const git = async (args: string[]) =>
      exec(
        "git",
        [
          "-c",
          "core.hooksPath=" +
            (process.platform === "win32" ? "NUL" : "/dev/null"),
          "-c",
          "commit.gpgSign=false",
          "-c",
          "user.name=Fixture",
          "-c",
          "user.email=fixture@example.invalid",
          ...args,
        ],
        { cwd: root, env, windowsHide: true },
      );
    await git(["init", "--template=", "-b", "main"]);
    await writeFile(join(root, "file.txt"), "COMMITTED");
    await git(["add", "file.txt"]);
    await git(["commit", "-m", "fixture"]);
    const head = (await git(["rev-parse", "HEAD"])).stdout.trim();
    await writeFile(join(root, "file.txt"), "DIRTY_SOURCE");
    const service = new WorkService(join(base, "data"));
    const provider = await startAgentProvider({
      reply: async (messages) => {
        const last = messages.filter((m) => m.type === "tool").at(-1);
        if (last) return new AIMessage("Receipt: " + String(last.content));
        const child = messages.some(
          (m) => m.type === "human" && m.content === "CHILD_TREE",
        );
        return new AIMessage({
          content: "",
          tool_calls: [
            {
              id: child ? "child-tree" : "root-tree",
              name: mode === "child" && !child ? "task" : "workspace_worktree",
              args:
                mode === "child" && !child
                  ? {
                      subagent_type: "general-purpose",
                      description: "CHILD_TREE",
                    }
                  : {},
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
        name: "Source",
        root,
      });
      const connectionId = randomUUID();
      service.models.save({
        id: connectionId,
        requestId: randomUUID(),
        expectedRevision: 0,
        config: {
          name: "fixture",
          provider: "openai-compatible",
          baseUrl: provider.baseUrl,
          modelId: "fixture",
          contextWindowTokens: 65536,
          maxOutputTokens: 256,
        },
      });
      const work = service.submit({
        requestId: randomUUID(),
        text: "CREATE_WORKTREE",
        mode: "configured",
        modelSelection: { connectionId, revision: 1 },
        workspaceId: workspace.id,
        workspaceRevision: 1,
        workspaceRead: false,
      });
      await expect
        .poll(() => service.store.get(work.id).status, { timeout: 15000 })
        .toBe(mode === "child" ? "failed" : "waiting_approval");
      const destination = join(base, "rocky-worktree-" + work.runId);
      await expect(stat(destination)).rejects.toThrow();
      if (mode !== "child") {
        const approval = service.store.get(work.id).approval!;
        expect(approval.worktreePreview).toEqual({
          destination,
          head,
          branch: "codex/rocky-" + work.runId,
        });
        if (mode === "stale") {
          await git(["add", "file.txt"]);
          await git(["commit", "-m", "changed"]);
        }
        if (mode === "registration-failure")
          vi.spyOn(service.workspaces, "save").mockRejectedValueOnce(
            new Error("Fixture registration failure"),
          );
        if (mode === "cancel") {
          const pending = service.store.get(work.id);
          service.stop(work.id, {
            requestId: randomUUID(),
            expectedRevision: pending.revision,
            runId: pending.runId,
            executionSessionId: pending.executionSessionId,
          });
          await expect(stat(destination)).rejects.toThrow();
          expect(
            service.operations
              .list(work.id)
              .some((o) => o.outcome === "succeeded"),
          ).toBe(false);
          return;
        }
        const command = {
          requestId: randomUUID(),
          expectedRevision: approval.revision,
          intentFingerprint: approval.intentFingerprint,
          decision: mode === "reject" ? "reject" : "approve",
        };
        service.decide(work.id, command);
        service.decide(work.id, command);
        await expect
          .poll(
            () =>
              ["completed", "failed", "blocked"].includes(
                service.store.get(work.id).status,
              ),
            { timeout: 15000 },
          )
          .toBe(true);
      }
      if (mode === "approve") {
        expect(
          service.store.get(work.id).status,
          service.store.get(work.id).error,
        ).toBe("completed");
        expect(await readFile(join(destination, "file.txt"), "utf8")).toBe(
          "COMMITTED",
        );
        const operation = service.operations.list(work.id)[0]!;
        expect(operation.outcome).toBe("succeeded");
        const receipt = JSON.parse(
          service.operations.get(operation.id)!.result!,
        );
        expect(receipt).toMatchObject({
          workspaceId: work.runId,
          head,
          readPermissionGranted: false,
          currentWorkWorkspaceChanged: false,
        });
        expect(service.workspaces.get(work.runId).root).toBe(destination);
        expect(service.store.get(work.id).workspaceId).toBe(workspace.id);
      } else if (mode === "registration-failure") {
        expect(service.store.get(work.id).status).toBe("blocked");
        expect(await readFile(join(destination, "file.txt"), "utf8")).toBe(
          "COMMITTED",
        );
        expect(service.workspaces.list()).toHaveLength(1);
        expect(service.operations.list(work.id)[0]?.outcome).toBe("unknown");
      } else {
        await expect(stat(destination)).rejects.toThrow();
        expect(service.workspaces.list()).toHaveLength(1);
        expect(
          service.operations
            .list(work.id)
            .some((o) => o.outcome === "succeeded"),
        ).toBe(false);
      }
      expect(await readFile(join(root, "file.txt"), "utf8")).toBe(
        "DIRTY_SOURCE",
      );
    } finally {
      await service.close();
      await provider.close();
      await rm(base, { recursive: true, force: true });
    }
  },
  30000,
);
