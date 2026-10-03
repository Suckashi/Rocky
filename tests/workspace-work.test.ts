import { test, expect, vi } from "vitest";
import { mkdtemp, mkdir, writeFile, rm, rename } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { AIMessage } from "@langchain/core/messages";
import { WorkService } from "../apps/daemon/src/work-service.js";
import { startAgentProvider } from "../fixtures/models/agent-provider.js";

test.each([
  "read",
  "denied",
  "traversal",
  "revoked",
  "replacement",
  "child",
  "shell",
  "paged",
  "changed-page",
] as const)("configured native workspace read boundary: %s", async (mode) => {
  const base = await mkdtemp(join(tmpdir(), "rocky-workspace-native-")),
    project = join(base, "project");
  await mkdir(project);
  const actual =
    "ACTUAL_REGISTERED_OWNER_TEXT" +
    (["paged", "changed-page"].includes(mode) ? '🐾\\"\n'.repeat(1500) : "");
  await writeFile(join(project, "actual.txt"), actual);
  const service = new WorkService(join(base, "data"));
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const provider = await startAgentProvider({
    reply: async (messages) => {
      if (["revoked", "replacement"].includes(mode)) await held;
      const tools = messages.filter((m) => m.type === "tool"),
        last = tools.at(-1);
      if (last) {
        if (
          ["paged", "changed-page"].includes(mode) &&
          last.name === "workspace_read"
        ) {
          const page = JSON.parse(String(last.content));
          if (mode === "changed-page")
            await writeFile(
              join(project, "actual.txt"),
              "CHANGED_PAGE_MUST_NOT_BE_DELIVERED",
            );
          if (page.nextOffset !== null)
            return new AIMessage({
              content: "",
              tool_calls: [
                {
                  id: "read-page-" + tools.length,
                  name: "workspace_read",
                  args: {
                    path: "actual.txt",
                    offset: page.nextOffset,
                    limit: 1024,
                    expectedHash: page.sha256,
                  },
                  type: "tool_call",
                },
              ],
            });
        }
        return new AIMessage(
          "Observed: " +
            (mode === "paged"
              ? "ACTUAL_REGISTERED_OWNER_TEXT"
              : String(last.content)),
        );
      }
      const child = messages.some(
        (m) =>
          m.type === "human" && String(m.content) === "CHILD_WORKSPACE_READ",
      );
      return new AIMessage({
        content: "",
        tool_calls: [
          {
            id: child ? "child-read" : "root-read",
            name:
              mode === "child" && !child
                ? "task"
                : mode === "shell"
                  ? "execute"
                  : "workspace_read",
            args:
              mode === "child" && !child
                ? {
                    subagent_type: "general-purpose",
                    description: "CHILD_WORKSPACE_READ",
                  }
                : mode === "shell"
                  ? { command: "echo HOST_EXECUTION_MUST_BE_DENIED" }
                  : {
                      path:
                        mode === "traversal" ? "../outside.txt" : "actual.txt",
                      ...(["paged", "changed-page"].includes(mode)
                        ? { limit: 1024 }
                        : {}),
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
        name: "Actual registered root",
        root: project,
      }),
      connectionId = randomUUID();
    service.models.save({
      id: connectionId,
      requestId: randomUUID(),
      expectedRevision: 0,
      config: {
        name: "Workspace provider fixture",
        provider: "openai-compatible",
        baseUrl: provider.baseUrl,
        modelId: "fixture",
        contextWindowTokens: 65536,
        maxOutputTokens: 256,
      },
    });
    const command = {
      requestId: randomUUID(),
      text: "ROOT_WORKSPACE_READ",
      mode: "configured",
      modelSelection: { connectionId, revision: 1 },
      workspaceId: workspace.id,
      workspaceRevision: 1,
      workspaceRead: mode !== "denied",
    };
    if (mode === "read") {
      const failed = vi
        .spyOn(service.grants, "issue")
        .mockImplementationOnce(() => {
          throw Error("injected grant commit failure");
        });
      expect(() => service.submit(command)).toThrow(
        "injected grant commit failure",
      );
      expect(service.store.list()).toHaveLength(0);
      expect(
        service.store.db
          .prepare("SELECT COUNT(*) AS count FROM model_budgets")
          .get()?.count,
      ).toBe(0);
      failed.mockRestore();
    }
    expect(() => service.submit({ ...command, workspaceRevision: 2 })).toThrow(
      "revision changed",
    );
    const work = service.submit(command);
    expect(service.submit(command).id).toBe(work.id);
    expect(service.grants.list(work.id)).toHaveLength(
      mode === "denied" ? 0 : 1,
    );
    if (mode === "revoked") {
      const grant = service.grants.list(work.id)[0]!;
      service.grants.revoke(work.id, grant.id, {
        requestId: randomUUID(),
        expectedRevision: 1,
      });
      expect(service.submit(command).id).toBe(work.id);
      expect(service.grants.list(work.id)).toEqual([
        expect.objectContaining({ id: grant.id, revoked: true }),
      ]);
    }
    if (mode === "replacement") {
      await rename(project, join(base, "original"));
      await mkdir(project);
      await writeFile(join(project, "actual.txt"), "REPLACEMENT_SECRET");
    }
    release();
    await expect
      .poll(
        () =>
          ["completed", "failed"].includes(service.store.get(work.id).status),
        { timeout: 15000 },
      )
      .toBe(true);
    const owned = service.store.get(work.id),
      wire = JSON.stringify(provider.requests);
    expect(owned.status, owned.error).toBe(
      ["read", "child", "paged"].includes(mode) ? "completed" : "failed",
    );
    if (["read", "child", "paged"].includes(mode)) {
      expect(owned.answer).toContain("ACTUAL_REGISTERED_OWNER_TEXT");
      expect(wire).toContain("untrustedData");
      if (mode !== "paged")
        expect(service.operations.list(work.id)).toEqual([
          expect.objectContaining({
            tool: "workspace_read",
            outcome: "succeeded",
            phase: "settled",
          }),
        ]);
      else {
        const final = provider.requests.at(-1)!;
        const messages = final.messages as { role: string; content: string }[];
        const pages = messages
          .filter((m) => m.role === "tool")
          .map((m) => JSON.parse(m.content));
        expect(pages.length).toBeGreaterThan(1);
        expect(pages.map((p) => p.text).join("")).toBe(actual);
        expect(pages.at(-1).nextOffset).toBe(null);
        expect(
          service.operations
            .list(work.id)
            .every((op) => op.outcome === "succeeded"),
        ).toBe(true);
      }
      if (mode === "child")
        expect(
          service.store
            .events("0", work.id)
            .some(
              (e) =>
                e.payload.kind === "domain" &&
                e.payload.name === "rocky.tool.completed" &&
                e.payload.data.child === true,
            ),
        ).toBe(true);
    } else if (mode === "changed-page") {
      expect(wire).toContain("ACTUAL_REGISTERED_OWNER_TEXT");
      expect(wire).not.toContain("CHANGED_PAGE_MUST_NOT_BE_DELIVERED");
      expect(service.operations.list(work.id).map((op) => op.outcome)).toEqual([
        "succeeded",
        "failed_known_no_effect",
      ]);
    } else {
      expect(wire).not.toContain("ACTUAL_REGISTERED_OWNER_TEXT");
      expect(wire).not.toContain("REPLACEMENT_SECRET");
      expect(
        service.operations
          .list(work.id)
          .every(
            (op) => op.outcome !== "unknown" && op.outcome !== "succeeded",
          ),
      ).toBe(true);
    }
    expect(
      provider.requests.every(
        (r) =>
          !JSON.stringify(r.tools).includes('"name":"inspect_sample"') &&
          !JSON.stringify(r.tools).includes('"name":"write_sample"'),
      ),
    ).toBe(true);
  } finally {
    release();
    await service.close();
    await provider.close();
    await rm(base, { recursive: true, force: true });
  }
});
