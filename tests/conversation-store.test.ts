import { test, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Store } from "../apps/daemon/src/store.js";
import { ConversationStore } from "../apps/daemon/src/conversation-store.js";
import type { Work } from "../packages/contracts/src/index.js";
import { WorkService } from "../apps/daemon/src/work-service.js";
import { createApp } from "../apps/daemon/src/http.js";
import {
  conversationPageSchema,
  conversationViewSchema,
  executionSessionSchema,
} from "../packages/contracts/src/conversation.js";
import { ContextLedger } from "../apps/daemon/src/context-ledger.js";
function work(
  kind: "main" | "background" = "main",
  runMode: "normal" | "evaluation" = "normal",
): Work {
  return {
    id: randomUUID(),
    runId: randomUUID(),
    executionSessionId: randomUUID(),
    requestId: randomUUID(),
    text: "visible user text",
    transport: "stdio",
    mode: "fixture",
    kind,
    runMode,
    status: "queued",
    revision: 1,
    answer: "",
    createdAt: new Date().toISOString(),
  };
}
test.each([1, 2])(
  "workspace revision/read scope isolates native checkpoint/history: revision %s",
  (nextRevision) => {
    const root = mkdtempSync(join(tmpdir(), "rocky-workspace-context-")),
      store = new Store(root),
      history = new ConversationStore(store),
      workspaceId = randomUUID();
    try {
      const first = {
        ...work(),
        workspaceId,
        workspaceRevision: 1,
        workspaceRead: true,
      };
      store.add(first, "first scope");
      store.save({ ...first, status: "running", revision: 2 }, 1);
      store.save(
        {
          ...first,
          status: "completed",
          answer: "OLD_WORKSPACE_EVIDENCE",
          revision: 3,
        },
        2,
      );
      const next = {
        ...work(),
        workspaceId,
        workspaceRevision: nextRevision,
        workspaceRead: nextRevision === 2,
      };
      store.add(next, "new scope");
      store.save({ ...next, status: "running", revision: 2 }, 1);
      expect(history.session(next.id).sourceGraphThreadId).toBeUndefined();
      expect(
        new ContextLedger(store).prepare({
          ...next,
          status: "running",
          revision: 2,
        }).items,
      ).toEqual([]);
      expect(() =>
        store.save(
          { ...next, workspaceRevision: 3, revision: 3, status: "running" },
          2,
        ),
      ).toThrow("Work revision changed");
      expect(() =>
        store.save(
          {
            ...next,
            workspaceRead: !next.workspaceRead,
            revision: 3,
            status: "running",
          },
          2,
        ),
      ).toThrow("Work revision changed");
    } finally {
      store.close();
      rmSync(root, { recursive: true, force: true });
    }
  },
);
test("one conversation persists separate execution sessions and atomic submission/result history", () => {
  const root = mkdtempSync(join(tmpdir(), "rocky-conversation-"));
  let store = new Store(root);
  try {
    let history = new ConversationStore(store);
    const id = history.main().id;
    const main = work();
    store.add(main, "intent");
    expect(history.session(main.id).graphThreadId).toBe(main.runId);
    expect(history.session(main.id).conversationId).toBe(id);
    main.status = "running";
    main.revision++;
    store.save(main, 1);
    expect(history.main().activeExecutionSessionId).toBe(
      main.executionSessionId,
    );
    expect(history.view().activeSession?.graphThreadId).toBe(main.runId);
    expect(history.view().cursor).toBe(
      history.page().messages.at(-1)?.sequence,
    );
    const background = work("background");
    store.add(background, "bg");
    background.status = "running";
    background.revision++;
    store.save(background, 1);
    expect(history.main().activeExecutionSessionId).toBe(
      main.executionSessionId,
    );
    main.answer = "confirmed result";
    main.status = "completed";
    main.revision++;
    store.transaction(() => {
      store.save(main, 2);
      store.event(main, "rocky.work.updated", { work: main });
    });
    expect(
      history.page().messages.filter((m) => m.role === "assistant"),
    ).toHaveLength(0);
    store.dispatchOutbox(() => {});
    store.db.prepare("UPDATE outbox SET delivered_at=NULL").run();
    store.dispatchOutbox(() => {});
    expect(
      history.page().messages.filter((m) => m.role === "assistant"),
    ).toHaveLength(1);
    expect(history.main().activeExecutionSessionId).toBeNull();
    expect(history.view().activeSession).toBeNull();
    store.close();
    store = new Store(root);
    history = new ConversationStore(store);
    expect(history.main().id).toBe(id);
    expect(history.page().messages.at(-1)?.text).toBe("confirmed result");
    expect(history.session(background.id).status).toBe("running");
    expect(() =>
      store.transaction(() => {
        store.add(work(), "rollback");
        throw Error("fault");
      }),
    ).toThrow("fault");
    expect(history.page().messages).toHaveLength(3);
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("Rocky v10 upgrade reconstructs chronological history and preserves only its own domain records", () => {
  const root = mkdtempSync(join(tmpdir(), "rocky-history-upgrade-"));
  let store = new Store(root);
  try {
    const first = work();
    first.createdAt = new Date(Date.now() - 86400000).toISOString();
    store.add(first, "one");
    first.status = "completed";
    first.answer = "saved outcome";
    first.revision++;
    store.save(first, 1);
    store.event(first, "rocky.work.updated", { work: first });
    store.dispatchOutbox(() => {});
    const second = work();
    second.createdAt = new Date(Date.now() + 86400000).toISOString();
    store.add(second, "two");
    store.db.exec(
      "DROP TABLE conversation_history; DROP TABLE execution_sessions; DROP TABLE conversations; PRAGMA user_version=10;",
    );
    store.close();
    store = new Store(root);
    const history = new ConversationStore(store);
    expect(history.page().messages.map((m) => m.id)).toEqual([
      "user-request:" + first.requestId,
      "work-result:" + first.id,
      "user-request:" + second.requestId,
    ]);
    expect(history.session(first.id).status).toBe("completed");
    const id = history.main().id;
    store.close();
    store = new Store(root);
    expect(new ConversationStore(store).main().id).toBe(id);
    expect(new ConversationStore(store).page().messages).toHaveLength(3);
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("conversation/history/session API validates DTOs and keeps current redaction at the public boundary", async () => {
  const root = mkdtempSync(join(tmpdir(), "rocky-history-api-"));
  const service = new WorkService(root);
  try {
    const app = createApp(service);
    const headers = { host: "127.0.0.1:3211" };
    const sample = work();
    service.store.add(sample, "intent");
    const history = await app.request("/api/v1/conversation/history", {
      headers,
    });
    expect(history.status).toBe(200);
    expect(
      conversationPageSchema.parse(await history.json()).messages[0]?.text,
    ).toBe(sample.text);
    expect(
      conversationViewSchema.parse(
        await (await app.request("/api/v1/conversation", { headers })).json(),
      ).id,
    ).toBe(new ConversationStore(service.store).main().id);
    expect(
      executionSessionSchema.parse(
        await (
          await app.request(`/api/v1/works/${sample.id}/execution-session`, {
            headers,
          })
        ).json(),
      ).id,
    ).toBe(sample.executionSessionId);
    expect(
      (await app.request("/api/v1/conversation/history?limit=101", { headers }))
        .status,
    ).toBe(400);
    expect(
      (
        await app.request("/api/v1/conversation/history?before=invalid", {
          headers,
        })
      ).status,
    ).toBe(400);
    service.store.publicEvidence = (value) =>
      JSON.parse(
        JSON.stringify(value).replaceAll("visible user text", "[REDACTED]"),
      );
    expect(new ConversationStore(service.store).page().messages[0]?.text).toBe(
      "[REDACTED]",
    );
  } finally {
    await service.close();
    rmSync(root, { recursive: true, force: true });
  }
});
test("history pagination uses numeric cursors, excludes evaluation and validates limits", () => {
  const root = mkdtempSync(join(tmpdir(), "rocky-conversation-"));
  const store = new Store(root);
  try {
    const history = new ConversationStore(store);
    for (let i = 0; i < 105; i++) store.add(work(), "intent");
    const evaluation = work("main", "evaluation");
    store.add(evaluation, "evaluation");
    expect(history.session(evaluation.id).kind).toBe("evaluation");
    let cursor: string | undefined;
    const ids: string[] = [];
    do {
      const page = history.page(cursor, 20);
      expect(
        page.messages.every(
          (m, i) =>
            i === 0 ||
            BigInt(m.sequence) > BigInt(page.messages[i - 1]!.sequence),
        ),
      ).toBe(true);
      ids.push(...page.messages.map((m) => m.id));
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    expect(new Set(ids).size).toBe(105);
    expect(() => history.page("invalid")).toThrow();
    expect(() => history.page(undefined, 101)).toThrow();
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});
