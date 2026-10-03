import { test, expect, vi } from "vitest";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  readdir,
  rm,
  link,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID, createHash } from "node:crypto";
import { AIMessage } from "@langchain/core/messages";
import { WorkService } from "../apps/daemon/src/work-service.js";
import { WorkspaceWriter } from "../apps/daemon/src/workspace-writes.js";
import { startAgentProvider } from "../fixtures/models/agent-provider.js";

test.each([
  "new",
  "replace",
  "reject",
  "stale",
  "cancel",
  "private",
  "child",
] as const)("native exact workspace write: %s", async (mode) => {
  const base = await mkdtemp(join(tmpdir(), "rocky-write-")),
    root = join(base, "project");
  await mkdir(root);
  const path = join(root, "output.md"),
    original = "ORIGINAL_OWNER_CONTENT",
    content = "ACTUAL_APPROVED_CONTENT\n🐾";
  const existing = ["replace", "stale"].includes(mode);
  if (existing) await writeFile(path, original);
  const expectedHash = existing
    ? createHash("sha256").update(original).digest("hex")
    : null;
  const service = new WorkService(join(base, "data"));
  const provider = await startAgentProvider({
    reply: async (messages) => {
      const last = messages.filter((m) => m.type === "tool").at(-1);
      if (last)
        return new AIMessage("Observed receipt: " + String(last.content));
      const child = messages.some(
        (m) => m.type === "human" && m.content === "CHILD_WRITE",
      );
      return new AIMessage({
        content: "",
        tool_calls: [
          {
            id: child ? "child-write" : "root-write",
            name: mode === "child" && !child ? "task" : "workspace_write",
            args:
              mode === "child" && !child
                ? {
                    subagent_type: "general-purpose",
                    description: "CHILD_WRITE",
                  }
                : {
                    path: mode === "private" ? ".env" : "output.md",
                    content,
                    expectedHash,
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
        name: "Write root",
        root,
      }),
      connectionId = randomUUID();
    service.models.save({
      id: connectionId,
      requestId: randomUUID(),
      expectedRevision: 0,
      config: {
        name: "Write model fixture",
        provider: "openai-compatible",
        baseUrl: provider.baseUrl,
        modelId: "fixture",
        contextWindowTokens: 65536,
        maxOutputTokens: 256,
      },
    });
    const work = service.submit({
      requestId: randomUUID(),
      text: "WRITE_ONE_FILE",
      mode: "configured",
      modelSelection: { connectionId, revision: 1 },
      workspaceId: workspace.id,
      workspaceRevision: 1,
      workspaceRead: false,
    });
    await expect
      .poll(() => service.store.get(work.id).status, { timeout: 15000 })
      .toBe(
        ["private", "child"].includes(mode) ? "failed" : "waiting_approval",
      );
    if (["private", "child"].includes(mode)) {
      await expect(readFile(path)).rejects.toThrow();
      expect(
        service.operations.list(work.id).some((o) => o.outcome === "succeeded"),
      ).toBe(false);
      return;
    }
    const pending = service.store.get(work.id),
      approval = pending.approval!;
    expect(approval.args).toEqual({ path: "output.md", content, expectedHash });
    expect(approval.targetPreview).toBe("output.md");
    if (existing) expect(await readFile(path, "utf8")).toBe(original);
    else await expect(readFile(path)).rejects.toThrow();
    if (mode === "stale") await writeFile(path, "EXTERNAL_CHANGED_CONTENT");
    if (mode === "cancel")
      service.stop(work.id, {
        requestId: randomUUID(),
        expectedRevision: pending.revision,
        runId: pending.runId,
        executionSessionId: pending.executionSessionId,
      });
    else {
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
    if (["new", "replace"].includes(mode)) {
      expect(
        service.store.get(work.id).status,
        service.store.get(work.id).error,
      ).toBe("completed");
      expect(await readFile(path, "utf8")).toBe(content);
      const operations = service.operations.list(work.id);
      expect(operations).toHaveLength(1);
      expect(operations[0]).toMatchObject({
        tool: "workspace_write",
        phase: "settled",
        outcome: "succeeded",
      });
      const receipt = JSON.parse(
        service.operations.get(operations[0]!.id)!.result!,
      );
      expect(receipt).toMatchObject({
        created: !existing,
        previousHash: expectedHash,
        sha256: createHash("sha256").update(content).digest("hex"),
        path: "output.md",
      });
    } else {
      if (mode === "stale") {
        expect(await readFile(path, "utf8")).toBe("EXTERNAL_CHANGED_CONTENT");
        expect(service.store.get(work.id).approval).toMatchObject({
          status: "expired",
          revision: 3,
        });
      } else await expect(readFile(path)).rejects.toThrow();
      expect(
        service.operations
          .list(work.id)
          .every((o) => o.outcome === "not_executed"),
      ).toBe(true);
    }
    expect(
      (await readdir(root)).some((n) => n.startsWith(".rocky-write-")),
    ).toBe(false);
  } finally {
    await service.close();
    await provider.close();
    await rm(base, { recursive: true, force: true });
  }
});

test("writer rejects cancelled, stale, unsafe and oversized proposals without changing files", async () => {
  const base = await mkdtemp(join(tmpdir(), "rocky-write-boundary-")),
    root = join(base, "project");
  await mkdir(root);
  const service = new WorkService(join(base, "data"));
  try {
    const workspace = await service.workspaces.save({
      id: randomUUID(),
      requestId: randomUUID(),
      expectedRevision: 0,
      name: "Boundaries",
      root,
    });
    const work = {
      ...service.submit({
        requestId: randomUUID(),
        text: "fixture",
        mode: "fixture",
      }),
      mode: "configured" as const,
      workspaceId: workspace.id,
      workspaceRevision: 1,
    };
    const writer = new WorkspaceWriter(service.workspaces),
      args = { path: "new.txt", content: "new", expectedHash: null };
    const proposal = await writer.prepare(work, args);
    await expect(
      writer.dispatch(proposal, AbortSignal.abort()),
    ).rejects.toMatchObject({ outcome: "failed_known_no_effect" });
    await writeFile(join(root, "new.txt"), "external");
    await expect(
      writer.dispatch(proposal, new AbortController().signal),
    ).rejects.toMatchObject({ outcome: "failed_known_no_effect" });
    expect(await readFile(join(root, "new.txt"), "utf8")).toBe("external");
    for (const path of ["../outside", ".env", ".git/config"])
      await expect(writer.prepare(work, { ...args, path })).rejects.toThrow();
    await expect(
      writer.prepare(work, { ...args, content: "🐾".repeat(20000) }),
    ).rejects.toThrow();
    await expect(
      writer.prepare(work, { ...args, content: "\0" }),
    ).rejects.toThrow();
    const uncertain = await writer.prepare(work, {
      ...args,
      path: "uncertain.txt",
    });
    const actualRoot = service.workspaces.root.bind(service.workspaces);
    let calls = 0;
    const rootFailure = vi
      .spyOn(service.workspaces, "root")
      .mockImplementation(async (...parameters) => {
        if (++calls === 3)
          throw Error("injected post-publication confirmation failure");
        return actualRoot(...parameters);
      });
    await expect(
      writer.dispatch(uncertain, new AbortController().signal),
    ).rejects.toMatchObject({ outcome: "unknown" });
    rootFailure.mockRestore();
    expect(await readFile(join(root, "uncertain.txt"), "utf8")).toBe("new");
    await link(join(root, "new.txt"), join(root, "hardlink.txt"));
    await expect(
      writer.prepare(work, { ...args, path: "hardlink.txt" }),
    ).rejects.toThrow();
    expect(
      (await readdir(root)).filter((n) => n.startsWith(".rocky-write-")),
    ).toEqual([]);
  } finally {
    await service.close();
    await rm(base, { recursive: true, force: true });
  }
});
