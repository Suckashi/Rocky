import { test, expect, vi } from "vitest";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { AIMessage } from "@langchain/core/messages";
import { WorkService } from "../apps/daemon/src/work-service.js";
import { createApp } from "../apps/daemon/src/http.js";
import { startAgentProvider } from "../fixtures/models/agent-provider.js";
test("artifact publication: native receipt, atomic registry, immutable download, restart and corruption", async () => {
  const base = await mkdtemp(join(tmpdir(), "rocky-artifact-")),
    root = join(base, "project"),
    data = join(base, "data");
  await mkdir(root);
  let service = new WorkService(data);
  const content =
    "\uFEFF<script>fetch('/api/v1/session')</script>\r\nOWNER_SNAPSHOT🐾";
  const provider = await startAgentProvider({
    reply: async (messages) =>
      messages.some((m) => m.type === "tool")
        ? new AIMessage("done")
        : new AIMessage({
            content: "",
            tool_calls: [
              {
                id: "write",
                name: "workspace_write",
                args: { path: "result.html", content, expectedHash: null },
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
        name: "Artifact source",
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
      text: "write artifact",
      mode: "configured",
      modelSelection: { connectionId, revision: 1 },
      workspaceId: workspace.id,
      workspaceRevision: 1,
    });
    await expect
      .poll(() => service.store.get(work.id).status, { timeout: 15000 })
      .toBe("waiting_approval");
    const approval = service.store.get(work.id).approval!;
    const command = {
      requestId: randomUUID(),
      operationId: approval.operationId!,
      title: "Result",
    };
    await expect(service.artifacts.publish(work.id, command)).rejects.toThrow(
      "confirmed",
    );
    service.decide(work.id, {
      requestId: randomUUID(),
      expectedRevision: approval.revision,
      intentFingerprint: approval.intentFingerprint,
      decision: "approve",
    });
    await expect
      .poll(() => service.store.get(work.id).status, { timeout: 15000 })
      .toBe("completed");
    let checks = 0;
    await expect(
      service.artifacts.publish(work.id, command, () => {
        if (++checks === 2) throw Error("Cancelled before commit");
      }),
    ).rejects.toThrow("Cancelled before commit");
    expect(checks).toBe(2);
    expect(service.artifacts.list()).toHaveLength(0);
    const recordEvent = service.store.event.bind(service.store);
    const fail = vi
      .spyOn(service.store, "event")
      .mockImplementation((work, name, data) => {
        // A late worker cleanup event must not consume the publication fault.
        if (name === "rocky.artifact.published")
          throw Error("Injected registry commit failure");
        return recordEvent(work, name, data);
      });
    await expect(service.artifacts.publish(work.id, command)).rejects.toThrow(
      "Injected",
    );
    fail.mockRestore();
    expect(service.artifacts.list()).toHaveLength(0);
    const artifact = await service.artifacts.publish(work.id, command);
    expect(await service.artifacts.publish(work.id, command)).toEqual(artifact);
    await expect(
      service.artifacts.publish(work.id, { ...command, title: "changed" }),
    ).rejects.toThrow("request changed");
    expect(artifact.files[0]?.sha256).toBe(
      createHash("sha256").update(content).digest("hex"),
    );
    const app = createApp(service),
      headers = { host: "127.0.0.1:3211" };
    expect(
      (
        await app.request(`/api/v1/works/${work.id}/artifacts`, {
          method: "POST",
          headers: { ...headers, "content-type": "application/json" },
          body: JSON.stringify({ ...command, requestId: randomUUID() }),
        })
      ).status,
    ).toBe(403);
    const download = await app.request(
      `/api/v1/artifacts/${artifact.id}/files/${artifact.entry}`,
      { headers },
    );
    expect(download.headers.get("content-type")).toBe(
      "application/octet-stream",
    );
    expect(download.headers.get("content-disposition")).toContain("attachment");
    expect(download.headers.get("content-security-policy")).toContain(
      "sandbox",
    );
    expect(Buffer.from(await download.arrayBuffer()).toString("utf8")).toBe(
      content,
    );
    await writeFile(join(root, "result.html"), "NEW_WORKSPACE_CONTENT");
    await expect(
      service.artifacts.publish(work.id, {
        ...command,
        requestId: randomUUID(),
      }),
    ).rejects.toThrow("revision changed");
    expect(
      (
        await service.artifacts.file(artifact.id, artifact.entry)
      ).bytes.toString("utf8"),
    ).toBe(content);
    await expect(
      service.artifacts.file(artifact.id, "../domain.sqlite"),
    ).rejects.toThrow("not found");
    await service.close();
    service = new WorkService(data);
    expect(service.artifacts.list()).toHaveLength(1);
    expect(
      (
        await service.artifacts.file(artifact.id, artifact.entry)
      ).bytes.toString("utf8"),
    ).toBe(content);
    expect(await readFile(join(root, "result.html"), "utf8")).toBe(
      "NEW_WORKSPACE_CONTENT",
    );
    await writeFile(
      join(data, "artifacts", artifact.files[0]!.sha256),
      "tampered",
    );
    await expect(
      service.artifacts.file(artifact.id, artifact.entry),
    ).rejects.toThrow("size changed");
  } finally {
    await service.close();
    await provider.close();
    await rm(base, { recursive: true, force: true });
  }
}, 30000);
