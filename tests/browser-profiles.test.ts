import { test, expect, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { chromium } from "playwright-core";
import { WorkService } from "../apps/daemon/src/work-service.js";
import type { Work } from "../packages/contracts/src/index.js";
import { AIMessage } from "@langchain/core/messages";
import { startAgentProvider } from "../fixtures/models/agent-provider.js";

test("browser profile changes after exact approval prevent dispatch and explicit retry needs fresh approval", async () => {
  const root = await mkdtemp(join(tmpdir(), "rocky-browser-approval-"));
  const service = new WorkService(root);
  const launch = vi
    .spyOn(chromium, "launchPersistentContext")
    .mockRejectedValue(new Error("Unapproved browser launch"));
  const provider = await startAgentProvider({
    reply: async () =>
      new AIMessage({
        content: "",
        tool_calls: [
          {
            id: "navigate",
            name: "browser_navigate",
            type: "tool_call",
            args: { url: "http://127.0.0.1:19999/fixture" },
          },
        ],
      }),
  });
  try {
    const id = randomUUID();
    service.models.save({
      id,
      requestId: randomUUID(),
      expectedRevision: 0,
      config: {
        name: "Browser approval fixture",
        provider: "openai-compatible",
        baseUrl: provider.baseUrl,
        modelId: "fixture",
        contextWindowTokens: 65536,
        maxOutputTokens: 128,
      },
    });
    const work = service.submit({
      requestId: randomUUID(),
      text: "Inspect an explicitly approved fixture page",
      mode: "configured",
      modelSelection: { connectionId: id, revision: 1 },
      browserOrigins: ["http://127.0.0.1:19999"],
    });
    await expect
      .poll(() => service.store.get(work.id).status, { timeout: 15000 })
      .toBe("waiting_approval");
    const pending = service.store.get(work.id),
      approval = pending.approval!;
    service.decide(work.id, {
      requestId: randomUUID(),
      expectedRevision: approval.revision,
      intentFingerprint: approval.intentFingerprint,
      decision: "approve",
    });
    // Synchronous owner mutation occurs after acceptance and before asynchronous worker dispatch.
    const profile = service.browsers.forWork(pending);
    service.browsers.share(profile.id, {
      requestId: randomUUID(),
      profileRevision: profile.revision,
      accountLabel: "Changed exact profile authority",
    });
    await expect
      .poll(() => service.store.get(work.id).status, { timeout: 15000 })
      .toBe("failed");
    expect(launch).not.toHaveBeenCalled();
    expect(service.operations.list(work.id)).toEqual([
      expect.objectContaining({ outcome: "not_executed" }),
    ]);
    const failed = service.store.get(work.id);
    const retry = service.retry(work.id, {
      requestId: randomUUID(),
      runId: failed.runId,
      executionSessionId: failed.executionSessionId,
      expectedRevision: failed.revision,
      effectRefs: [],
    });
    await expect
      .poll(() => service.store.get(retry.id).status, { timeout: 15000 })
      .toBe("waiting_approval");
    expect(service.store.get(retry.id).approval!.intentFingerprint).not.toBe(
      approval.intentFingerprint,
    );
    expect(launch).not.toHaveBeenCalled();
  } finally {
    await service.close();
    await provider.close();
    launch.mockRestore();
    await rm(root, { recursive: true, force: true });
  }
}, 30000);

test("browser profiles bind explicit origins and sharing; unavailable isolation never launches Native", async () => {
  const root = await mkdtemp(join(tmpdir(), "rocky-browser-contract-")),
    service = new WorkService(root);
  const launch = vi
    .spyOn(chromium, "launchPersistentContext")
    .mockRejectedValue(new Error("Must not launch a host browser"));
  const makeWork = (): Work => ({
    id: randomUUID(),
    runId: randomUUID(),
    executionSessionId: randomUUID(),
    requestId: randomUUID(),
    text: "Synthetic browser scope",
    transport: "http",
    mode: "configured",
    modelSelection: { connectionId: randomUUID(), revision: 1 },
    runMode: "normal",
    status: "completed",
    revision: 1,
    answer: "",
    createdAt: new Date().toISOString(),
  });
  try {
    const work = makeWork();
    service.store.transaction(() => {
      work.browserProfileId = service.browsers.bind(work, [
        "https://example.com",
      ]);
      service.store.add(work, work.id);
    });
    const profile = service.browsers.forWork(work);
    expect(profile.sharingPolicy).toBe("exclusive");
    expect(() =>
      service.browsers.validate(work, "browser_navigate", {
        url: "https://other.example/",
      }),
    ).toThrow("outside");
    expect(() =>
      service.browsers.validate(work, "browser_navigate", {
        url: "https://user:password@example.com/",
      }),
    ).toThrow("outside");
    const other = makeWork();
    expect(() =>
      service.store.transaction(() =>
        service.browsers.bindShared(other, profile.id),
      ),
    ).toThrow("Shared profile");
    const shared = service.browsers.share(profile.id, {
      requestId: randomUUID(),
      profileRevision: profile.revision,
      accountLabel: "Fixture account",
    });
    service.store.transaction(() => {
      other.browserProfileId = service.browsers.bindShared(other, shared.id);
      service.store.add(other, other.id);
    });
    expect(service.browsers.forWork(other).id).toBe(profile.id);
    expect(service.browsers.forWork(other).allowedOrigins).toEqual([
      "https://example.com",
    ]);
    const isolated = { ...makeWork(), environmentId: randomUUID() };
    service.store.transaction(() => {
      isolated.browserProfileId = service.browsers.bind(isolated, [
        "https://example.com",
      ]);
      service.store.add(isolated, isolated.id);
    });
    const bound = service.browsers.forWork(isolated),
      command = {
        requestId: randomUUID(),
        profileRevision: bound.revision,
        action: "open",
      };
    await expect(service.browsers.control(bound.id, command)).rejects.toThrow(
      "No Native fallback",
    );
    await expect(service.browsers.control(bound.id, command)).rejects.toThrow(
      "No Native fallback",
    );
    expect(launch).not.toHaveBeenCalled();
    await expect(service.browsers.snapshot(work)).rejects.toThrow(
      "unavailable",
    );
  } finally {
    launch.mockRestore();
    await service.close();
    await rm(root, { recursive: true, force: true });
  }
});
