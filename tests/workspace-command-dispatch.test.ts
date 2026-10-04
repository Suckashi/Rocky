import { test, expect, vi } from "vitest";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Store } from "../apps/daemon/src/store.js";
import { WorkspaceRegistry } from "../apps/daemon/src/workspaces.js";
import { WorkspaceCommands } from "../apps/daemon/src/workspace-commands.js";
import { WorkspaceCommandDispatch } from "../apps/daemon/src/workspace-command-dispatch.js";
import { OperationLedger } from "../apps/daemon/src/operation-ledger.js";
import { workSchema } from "../packages/contracts/src/index.js";

test.each([
  "approved",
  "rejected",
  "wrong_hash",
  "nonzero",
  "cancelled",
  "configuration_revoked",
] as const)(
  "native ledger dispatch: %s",
  async (mode) => {
    const base = await mkdtemp(join(tmpdir(), "rocky-command-dispatch-")),
      root = join(base, "project");
    await mkdir(root);
    const store = new Store(join(base, "data")),
      registry = new WorkspaceRegistry(store),
      ledger = new OperationLedger(store);
    const controller = new AbortController();
    store.publicEvidence = (value) =>
      JSON.parse(
        JSON.stringify(value).replaceAll(
          "synthetic-output-secret",
          "[REDACTED]",
        ),
      );
    try {
      const workspace = await registry.save({
        id: randomUUID(),
        requestId: randomUUID(),
        expectedRevision: 0,
        name: "Command test",
        root,
      });
      let work = workSchema.parse({
        id: randomUUID(),
        runId: randomUUID(),
        executionSessionId: randomUUID(),
        requestId: randomUUID(),
        workspaceId: workspace.id,
        workspaceRevision: 1,
        text: "Explicit command fixture",
        transport: "http",
        mode: "configured",
        modelSelection: { connectionId: randomUUID(), revision: 1 },
        runMode: "normal",
        status: "running",
        revision: 1,
        answer: "",
        createdAt: new Date().toISOString(),
      });
      store.add(work, "command fixture");
      const signal = controller.signal;
      const proposal = await new WorkspaceCommands(registry).prepare(
        work,
        {
          executable: process.execPath,
          args: [
            "-e",
            "require('node:fs').appendFileSync('executions.txt','one\\n');console.log('synthetic-output-secret');process.exitCode=" +
              (mode === "nonzero" ? "7" : "0") +
              (mode === "cancelled" ? ";setInterval(()=>{},1000)" : ""),
          ],
          timeoutMs: 5000,
          maxOutputBytes: 4096,
        },
        signal,
      );
      const operation = ledger.prepare(
        work,
        "one-command",
        "workspace_command",
        proposal.args,
        proposal.fingerprint,
        proposal.targetIdentity,
      );
      const dispatch = new WorkspaceCommandDispatch(
        store,
        registry,
        ledger,
        () => {
          if (mode === "configuration_revoked")
            throw new Error("Configuration revoked");
        },
      );
      // No approved daemon record means no process, even with an intact proposal.
      await expect(
        dispatch.execute(work.id, "one-command", proposal, signal),
      ).rejects.toThrow();
      await expect(readFile(join(root, "executions.txt"))).rejects.toThrow();
      work = {
        ...work,
        revision: 2,
        approval: {
          id: randomUUID(),
          revision: 1,
          tool: "workspace_command",
          operationId: operation.id,
          args: proposal.args,
          intentFingerprint:
            mode === "wrong_hash" ? "0".repeat(64) : proposal.fingerprint,
          status: mode === "rejected" ? "rejected" : "approved",
        },
      };
      store.save(work, 1);
      if (mode === "approved") {
        const result = await dispatch.execute(
          work.id,
          "one-command",
          proposal,
          signal,
        );
        expect(JSON.parse(result)).toMatchObject({
          reason: "exited",
          exitCode: 0,
          untrustedData: true,
          isolation: "none",
        });
        expect(
          await dispatch.execute(work.id, "one-command", proposal, signal),
        ).toBe(result);
        expect(ledger.get(operation.id)?.outcome).toBe("succeeded");
        expect(result).toContain("[REDACTED]");
        expect(ledger.get(operation.id)?.result).not.toContain(
          "synthetic-output-secret",
        );
      } else {
        const rejected = expect(
          dispatch.execute(work.id, "one-command", proposal, signal),
        ).rejects.toThrow();
        if (mode === "cancelled") {
          await vi.waitFor(async () =>
            expect(await readFile(join(root, "executions.txt"), "utf8")).toBe(
              "one\n",
            ),
          );
          controller.abort();
        }
        await rejected;
        if (mode === "nonzero" || mode === "cancelled") {
          expect(ledger.get(operation.id)).toMatchObject({
            phase: "settled",
            outcome: "unknown",
          });
          await expect(
            dispatch.execute(
              work.id,
              "one-command",
              proposal,
              new AbortController().signal,
            ),
          ).rejects.toThrow("reconciliation");
        } else expect(ledger.get(operation.id)?.phase).toBe("prepared");
      }
      if (mode === "approved" || mode === "nonzero" || mode === "cancelled")
        expect(await readFile(join(root, "executions.txt"), "utf8")).toBe(
          "one\n",
        );
      else
        await expect(readFile(join(root, "executions.txt"))).rejects.toThrow();
    } finally {
      controller.abort();
      store.close();
      await rm(base, { recursive: true, force: true });
    }
  },
  15000,
);
