import { test, expect, vi } from "vitest";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { AIMessage } from "@langchain/core/messages";
import { WorkService } from "../apps/daemon/src/work-service.js";
import { createApp } from "../apps/daemon/src/http.js";
import { startAgentProvider } from "../fixtures/models/agent-provider.js";
test("document revisions: confirmed artifact source, concurrent CAS, immutable history and receipts, rollback and restart", async () => {
  const base = await mkdtemp(join(tmpdir(), "rocky-documents-")),
    root = join(base, "project"),
    data = join(base, "data");
  await mkdir(root);
  const original =
    "\uFEFF# Source\r\n\r\n```custom-language\r\nUNSUPPORTED_SYNTAX_MUST_REMAIN\r\n```\r\n🐾";
  let service = new WorkService(data);
  const provider = await startAgentProvider({
    reply: async (messages) =>
      messages.some((m) => m.type === "tool")
        ? new AIMessage("confirmed")
        : new AIMessage({
            content: "",
            tool_calls: [
              {
                id: "doc-source",
                name: "workspace_write",
                args: {
                  path: "source.md",
                  content: original,
                  expectedHash: null,
                },
                type: "tool_call",
              },
            ],
          }),
  });
  try {
    const workspace = await service.workspaces.save({
        id: randomUUID(),
        requestId: randomUUID(),
        expectedRevision: 0,
        name: "Source",
        root,
      }),
      connectionId = randomUUID();
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
      text: "Write document source",
      mode: "configured",
      workspaceId: workspace.id,
      workspaceRevision: 1,
      modelSelection: { connectionId, revision: 1 },
    });
    await expect
      .poll(() => service.store.get(work.id).status, { timeout: 15000 })
      .toBe("waiting_approval");
    const approval = service.store.get(work.id).approval!;
    service.decide(work.id, {
      requestId: randomUUID(),
      expectedRevision: approval.revision,
      intentFingerprint: approval.intentFingerprint,
      decision: "approve",
    });
    await expect
      .poll(() => service.store.get(work.id).status, { timeout: 15000 })
      .toBe("completed");
    const artifact = await service.artifacts.publish(work.id, {
      requestId: randomUUID(),
      operationId: approval.operationId!,
      title: "Original document",
    });
    const create = { requestId: randomUUID(), artifactId: artifact.id };
    const first = await service.documents.create(create);
    expect(await service.documents.create(create)).toEqual(first);
    expect(first.content).toBe(original);
    const app = createApp(service),
      baseHeaders = {
        host: "127.0.0.1:3211",
        "content-type": "application/json",
      };
    const { token } = await (
      await app.request("/api/v1/session", { headers: baseHeaders })
    ).json();
    const headers = { ...baseHeaders, "x-rocky-session": token };
    const url = `/api/v1/documents/${first.document.id}`;
    const commands = ["EDITOR_A", "EDITOR_B"].map((content) => ({
      requestId: randomUUID(),
      expectedRevision: 1,
      title: "Edited",
      content,
    }));
    expect(
      (
        await app.request(url, {
          method: "POST",
          headers: baseHeaders,
          body: JSON.stringify(commands[0]),
        })
      ).status,
    ).toBe(403);
    const replies = await Promise.all(
      commands.map((command) =>
        app.request(url, {
          method: "POST",
          headers,
          body: JSON.stringify(command),
        }),
      ),
    );
    expect(replies.map((r) => r.status).sort()).toEqual([200, 409]);
    const winner = replies.findIndex((r) => r.status === 200),
      second = service.documents.get(first.document.id);
    expect(second.document.revision).toBe(2);
    expect(second.content).toBe(commands[winner]!.content);
    expect(service.documents.get(first.document.id, 1)).toEqual(first);
    const fail = vi.spyOn(service.store, "event").mockImplementationOnce(() => {
      throw Error("Injected document event failure");
    });
    expect(() =>
      service.documents.save(first.document.id, {
        requestId: randomUUID(),
        expectedRevision: 2,
        title: "ROLLBACK",
        content: "DO_NOT_COMMIT",
      }),
    ).toThrow("Injected");
    fail.mockRestore();
    expect(service.documents.get(first.document.id)).toEqual(second);
    const largeResponse = await app.request(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        requestId: randomUUID(),
        expectedRevision: 2,
        title: "Too large",
        content: "🐾".repeat(17000),
      }),
    });
    expect(largeResponse.status, await largeResponse.text()).toBe(422);
    expect(service.documents.get(first.document.id)).toEqual(second);
    const third = service.documents.save(first.document.id, {
      requestId: randomUUID(),
      expectedRevision: 2,
      title: "Final",
      content: original + "\nNEW_REVISION",
    });
    expect(third.document.revision).toBe(3);
    expect(() =>
      service.documents.save(first.document.id, {
        requestId: randomUUID(),
        expectedRevision: 3,
        title: "Invalid Unicode",
        content: "\ud800",
      }),
    ).toThrow("UTF-8");
    expect(service.documents.save(first.document.id, commands[winner])).toEqual(
      second,
    );
    expect(() =>
      service.documents.save(first.document.id, {
        ...commands[winner],
        content: "CHANGED_INTENT",
      }),
    ).toThrow("request changed");
    const redact = service.store.publicEvidence;
    service.store.publicEvidence = (value) =>
      typeof value === "string" && value.includes("PROTECTED_FIXTURE")
        ? "[protected]"
        : redact(value);
    expect(() =>
      service.documents.save(first.document.id, {
        requestId: randomUUID(),
        expectedRevision: 3,
        title: "Secret",
        content: "PROTECTED_FIXTURE",
      }),
    ).toThrow("protected content");
    service.store.publicEvidence = redact;
    expect(
      (
        await service.artifacts.file(artifact.id, artifact.entry)
      ).bytes.toString("utf8"),
    ).toBe(original);
    const boundary = await service.documents.create({
      requestId: randomUUID(),
      artifactId: artifact.id,
    });
    const boundaryResponse = await app.request(
      `/api/v1/documents/${boundary.document.id}`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          requestId: randomUUID(),
          expectedRevision: 1,
          title: "64KiB boundary",
          content: "x".repeat(65536),
        }),
      },
    );
    expect(boundaryResponse.status, await boundaryResponse.clone().text()).toBe(
      200,
    );
    expect(service.documents.get(boundary.document.id).content).toHaveLength(
      65536,
    );
    await service.close();
    service = new WorkService(data);
    expect(service.documents.get(first.document.id)).toEqual(third);
    expect(service.documents.get(first.document.id, 1)).toEqual(first);
    expect(service.documents.list()).toHaveLength(2);
    const restartedApp = createApp(service);
    const historical = await restartedApp.request(
      `/api/v1/documents/${first.document.id}/download?revision=1`,
      { headers: baseHeaders },
    );
    expect(historical.headers.get("content-disposition")).toContain(
      "attachment",
    );
    expect(Buffer.from(await historical.arrayBuffer()).toString("utf8")).toBe(
      original,
    );
  } finally {
    await service.close();
    await provider.close();
    await rm(base, { recursive: true, force: true });
  }
}, 30000);
