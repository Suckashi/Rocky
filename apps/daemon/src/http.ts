import { Hono, type Context } from "hono";
import { ConversationStore } from "./conversation-store.js";
import { SteeringStore } from "./steering.js";
import { streamSSE } from "hono/streaming";
import { serveStatic } from "@hono/node-server/serve-static";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { RunAgentInputSchema, EventSchemas } from "@ag-ui/core/schemas";
import {
  RockyError,
  errorSchema,
  sequenceSchema,
  modelSelectionSchema,
} from "../../../packages/contracts/src/index.js";
import { WorkService } from "./work-service.js";
import { modelBudgetSchema } from "../../../packages/contracts/src/model-budget.js";
async function readJson(c: Context): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    throw new RockyError(
      "invalid_json",
      "Request body must be valid JSON",
      400,
    );
  }
}
export function createApp(service: WorkService) {
  const app = new Hono(),
    token = randomBytes(32).toString("hex");
  app.use("/api/v1/*", async (c, next) => {
    await next();
    if (
      c.req.path !== "/api/v1/session" &&
      !(c.req.path === "/api/v1/mcp-config" && c.res.ok) &&
      c.res.headers.get("content-type")?.includes("application/json")
    ) {
      const body = service.store.publicEvidence(await c.res.clone().json());
      const headers = new Headers(c.res.headers);
      headers.delete("content-length");
      c.res = new Response(JSON.stringify(body), {
        status: c.res.status,
        headers,
      });
    }
  });
  app.use("*", async (c, next) => {
    c.header(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; font-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
    );
    c.header("X-Content-Type-Options", "nosniff");
    await next();
  });
  app.use("/api/*", async (c, next) => {
    c.header("Cache-Control", "no-store");
    const host = c.req.header("host") ?? "";
    if (!/^(127\.0\.0\.1|localhost):(3210|3211)$/.test(host))
      return c.json(
        { code: "host_denied", message: "Loopback host required" },
        403,
      );
    const origin = c.req.header("origin");
    if (
      origin &&
      ![
        "http://127.0.0.1:3210",
        "http://127.0.0.1:3211",
        "http://localhost:3210",
        "http://localhost:3211",
      ].includes(origin)
    )
      return c.json({ code: "origin_denied", message: "Origin denied" }, 403);
    if (c.req.method !== "GET" && c.req.header("x-rocky-session") !== token)
      return c.json(
        { code: "session_required", message: "Local session required" },
        403,
      );
    // Document text still has a 64KiB decoded-byte cap; allow bounded JSON escaping.
    const bodyLimit = /^\/api\/v1\/documents(?:\/[a-f0-9-]{36})?$/i.test(
      c.req.path,
    )
      ? 524288
      : 65536;
    if (Number(c.req.header("content-length") ?? 0) > bodyLimit)
      return c.json({ code: "too_large", message: "Request too large" }, 413);
    // Enforce bytes actually received, including chunked bodies without Content-Length.
    if (c.req.raw.body) {
      const reader = c.req.raw.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > bodyLimit) {
            await reader.cancel();
            return c.json(
              { code: "too_large", message: "Request too large" },
              413,
            );
          }
          chunks.push(value);
        }
      } finally {
        reader.releaseLock();
      }
      c.req.raw = new Request(c.req.raw, { body: Buffer.concat(chunks) });
    }
    await next();
  });
  app.onError((error, c) => {
    const status =
      error instanceof RockyError
        ? error.status
        : error instanceof z.ZodError
          ? 400
          : 500;
    return c.json(
      errorSchema.parse({
        code:
          error instanceof RockyError
            ? error.code
            : status === 500
              ? "internal_error"
              : "invalid_request",
        message:
          error instanceof z.ZodError
            ? "Request does not match the supported schema"
            : status === 500
              ? "Internal error"
              : error.message,
      }),
      status as 400,
    );
  });
  app.get("/api/v1/session", (c) => c.json({ token }));
  app.get("/api/v1/assistant", (c) => c.json(service.store.assistant()));
  app.get("/api/v1/model-connections", (c) =>
    c.json({ connections: service.models.list() }),
  );
  app.post("/api/v1/model-connections", async (c) =>
    c.json(service.models.save(await readJson(c))),
  );
  app.post("/api/v1/model-connections/:id/probe", async (c) =>
    c.json(await service.models.probe(c.req.param("id"), await readJson(c))),
  );
  app.get("/api/v1/health", (c) =>
    c.json({
      productId: "rocky",
      status: service.deliveryError ? "degraded" : "ready",
      mode: "fixture-capable",
      delivery: {
        pending: service.store.pendingDeliveries(),
        error: service.deliveryError,
      },
    }),
  );
  app.get("/api/v1/capabilities", (c) =>
    c.json({
      model: {
        configured: service.models.list().length > 0,
        verified: false,
        runtimeAvailable: true,
        connectionProbing: true,
      },
      fixture: { available: true },
      learning: { mode: "off" },
      remote: { created: false },
    }),
  );
  app.get("/api/v1/works", (c) => c.json({ works: service.store.list() }));
  app.get("/api/v1/works/:id/operations", (c) =>
    c.json({ operations: service.operations.list(c.req.param("id")) }),
  );
  app.post("/api/v1/works/:id/reconcile", async (c) =>
    c.json(
      await service.reconcileOperation(
        c.req.param("id"),
        await readJson(c),
        c.req.raw.signal,
      ),
    ),
  );
  app.get("/api/v1/works/:id/grants", (c) => {
    const work = service.store.get(c.req.param("id"));
    return c.json({ grants: service.grants.list(work.id) });
  });
  app.post("/api/v1/works/:id/grants/:grantId/revoke", async (c) => {
    const work = service.store.get(c.req.param("id"));
    return c.json(
      service.grants.revoke(work.id, c.req.param("grantId"), await readJson(c)),
    );
  });
  app.get("/api/v1/works/:id/model-usage", (c) =>
    c.json(
      service.modelBudgets.snapshot(service.store.get(c.req.param("id")).runId),
    ),
  );
  app.get("/api/v1/conversation", (c) =>
    c.json(new ConversationStore(service.store).view()),
  );
  app.get("/api/v1/conversation/history", (c) =>
    c.json(
      new ConversationStore(service.store).page(
        c.req.query("before"),
        c.req.query("limit") === undefined ? 50 : Number(c.req.query("limit")),
      ),
    ),
  );
  app.get("/api/v1/works/:id/execution-session", (c) =>
    c.json(new ConversationStore(service.store).session(c.req.param("id"))),
  );
  app.get("/api/v1/conversation/messages", (c) =>
    c.json(
      service.store.completions(
        c.req.query("before"),
        c.req.query("limit") === undefined ? 50 : Number(c.req.query("limit")),
      ),
    ),
  );
  app.get("/api/v1/snapshot", (c) => {
    if (c.req.query("after") !== undefined)
      sequenceSchema.parse(c.req.query("after"));
    return c.json(service.store.snapshot());
  });
  app.get("/api/v1/works/:id", (c) =>
    c.json(service.store.get(c.req.param("id"))),
  );
  app.get("/api/v1/mcp-config", (c) => c.json(service.mcp.snapshot()));
  app.get("/api/v1/documents", (c) =>
    c.json({ documents: service.documents.list() }),
  );
  app.post("/api/v1/documents", async (c) =>
    c.json(await service.documents.create(await readJson(c))),
  );
  app.get("/api/v1/documents/:id", (c) =>
    c.json(
      service.documents.get(
        c.req.param("id"),
        c.req.query("revision") === undefined
          ? undefined
          : Number(c.req.query("revision")),
      ),
    ),
  );
  app.post("/api/v1/documents/:id", async (c) =>
    c.json(service.documents.save(c.req.param("id"), await readJson(c))),
  );
  app.get("/api/v1/documents/:id/download", (c) => {
    const value = service.documents.get(
      c.req.param("id"),
      c.req.query("revision") === undefined
        ? undefined
        : Number(c.req.query("revision")),
    );
    c.header("Content-Type", "application/octet-stream");
    c.header(
      "Content-Disposition",
      `attachment; filename="document-${value.document.id}-r${value.document.revision}.md"`,
    );
    c.header("Content-Security-Policy", "default-src 'none'; sandbox");
    return c.body(new Uint8Array(Buffer.from(value.content, "utf8")));
  });
  app.get("/api/v1/artifacts", (c) =>
    c.json({ artifacts: service.artifacts.list() }),
  );
  app.post("/api/v1/works/:id/artifacts", async (c) =>
    c.json(
      await service.artifacts.publish(c.req.param("id"), await readJson(c)),
    ),
  );
  app.get("/api/v1/artifacts/:id", (c) =>
    c.json(service.artifacts.get(c.req.param("id"))),
  );
  app.get("/api/v1/artifacts/:id/files/:fileId", async (c) => {
    const { entry, bytes } = await service.artifacts.file(
      c.req.param("id"),
      c.req.param("fileId"),
    );
    c.header("Content-Type", "application/octet-stream");
    c.header(
      "Content-Disposition",
      "attachment; filename*=UTF-8''" + encodeURIComponent(entry.name),
    );
    c.header("Content-Security-Policy", "default-src 'none'; sandbox");
    return c.body(new Uint8Array(bytes));
  });
  app.get("/api/v1/artifacts/:id/preview", async (c) => {
    const artifact = service.artifacts.get(c.req.param("id"));
    const { entry, bytes } = await service.artifacts.file(
      artifact.id,
      artifact.entry,
    );
    return c.json({
      mime: entry.mime,
      text: bytes.toString("utf8"),
      sha256: entry.sha256,
    });
  });
  app.get("/api/v1/workspaces", (c) =>
    c.json({ workspaces: service.workspaces.list() }),
  );
  app.post("/api/v1/workspaces", async (c) =>
    c.json(await service.workspaces.save(await readJson(c))),
  );
  app.get("/api/v1/workspaces/:id/files", async (c) =>
    c.json(
      await service.workspaces.files(
        c.req.param("id"),
        z.coerce.number().int().positive().parse(c.req.query("revision")),
        c.req.query("path") ?? "",
      ),
    ),
  );
  app.get("/api/v1/workspaces/:id/file", async (c) =>
    c.json(
      await service.workspaces.read(
        c.req.param("id"),
        z.coerce.number().int().positive().parse(c.req.query("revision")),
        z.string().min(1).max(4096).parse(c.req.query("path")),
        c.req.query("sha256"),
      ),
    ),
  );
  app.get("/api/v1/mcp-servers", (c) =>
    c.json({ servers: service.mcpManager.list() }),
  );
  app.post("/api/v1/mcp-servers/:id/connect", async (c) =>
    c.json(
      await service.mcpManager.connect(c.req.param("id"), await readJson(c)),
    ),
  );
  app.post("/api/v1/mcp-servers/:id/stop", async (c) =>
    c.json(await service.mcpManager.stop(c.req.param("id"), await readJson(c))),
  );
  app.post("/api/v1/mcp-config", async (c) =>
    c.json(service.mcp.save(await readJson(c))),
  );
  app.post("/api/v1/conversation/messages", async (c) =>
    c.json(service.submit(await readJson(c)), 202),
  );
  app.post("/api/v1/approvals/:id/preview", async (c) =>
    c.json(await service.previewWrite(c.req.param("id"), await readJson(c))),
  );
  app.post("/api/v1/approvals/:id/decision", async (c) => {
    const work = service.store
      .list()
      .find((w) => w.approval?.id === c.req.param("id"));
    if (!work) throw new RockyError("not_found", "Approval not found", 404);
    return c.json(service.decide(work.id, await readJson(c)));
  });
  app.post("/api/v1/works/:id/stop", async (c) =>
    c.json(service.stop(c.req.param("id"), await readJson(c))),
  );
  app.post("/api/v1/works/:id/steer", async (c) =>
    c.json(service.steer(c.req.param("id"), await readJson(c))),
  );
  app.post("/api/v1/works/:id/retry", async (c) =>
    c.json(service.retry(c.req.param("id"), await readJson(c)), 202),
  );
  app.get("/api/v1/works/:id/retry-review", (c) =>
    c.json(
      service.store.publicEvidence(
        service.operations.retryReview(service.store.get(c.req.param("id"))),
      ),
    ),
  );
  app.get("/api/v1/works/:id/steering", (c) => {
    service.store.get(c.req.param("id"));
    return c.json({
      receipts: service.store.publicEvidence(
        new SteeringStore(service.store).list(c.req.param("id")),
      ),
    });
  });
  app.get("/api/v1/events", (c) => {
    let after = c.req.header("last-event-id") ?? c.req.query("after") ?? "0";
    service.store.events(after); // validate before committing SSE headers
    return streamSSE(c, async (stream) => {
      await stream.write(": rocky connected\n\n");
      let done = false;
      stream.onAbort(() => {
        done = true;
      });
      while (!done) {
        for (const event of service.store.events(after)) {
          after = event.sequence;
          await stream.writeSSE({
            id: event.sequence,
            data: JSON.stringify(service.models.redact(event)),
          });
        }
        await stream.sleep(150);
      }
    });
  });
  app.get("/api/v1/copilotkit/info", (c) =>
    c.json({
      version: "1.77.0",
      mode: "sse",
      agents: { rocky: { description: "Rocky local Work facade" } },
      audioFileTranscriptionEnabled: false,
      telemetryDisabled: true,
    }),
  );
  app.post("/api/v1/copilotkit/agent/rocky/run", async (c) => {
    const input = RunAgentInputSchema.parse(await readJson(c));
    const props = z
      .object({
        mode: z.enum(["fixture", "configured"]),
        modelSelection: modelSelectionSchema.optional(),
        modelBudget: modelBudgetSchema.optional(),
        workspaceId: z.uuid().optional(),
        workspaceRevision: z.number().int().positive().optional(),
        workspaceRead: z.boolean().optional(),
        transport: z.enum(["stdio", "http"]),
      })
      .strict()
      .parse(input.forwardedProps);
    const last = input.messages.findLast((m) => m.role === "user");
    const content = last?.content;
    const text =
      typeof content === "string"
        ? content
        : Array.isArray(content)
          ? content
              .filter((p) => p.type === "text")
              .map((p) => ("text" in p ? p.text : ""))
              .join("")
          : "";
    const work = service.submit({ requestId: input.runId, text, ...props });
    return streamSSE(c, async (stream) => {
      const send = async (event: unknown) => {
        const safe = service.models.redact(event);
        EventSchemas.parse(safe);
        await stream.writeSSE({ data: JSON.stringify(safe) });
      };
      await send({
        type: "RUN_STARTED",
        threadId: input.threadId,
        runId: input.runId,
      });
      let after = "0",
        done = false;
      let streamMessageId = "",
        streamText = "",
        messageOpen = false;
      stream.onAbort(() => {
        done = true;
      });
      while (!done) {
        const batch = service.store.events(after, work.id);
        for (const event of batch) {
          after = event.sequence;
          if (event.workId !== work.id) continue;
          if (event.payload.kind === "domain") {
            await send({
              type: "CUSTOM",
              name: event.payload.name,
              value: event,
            });
            if (event.payload.name === "rocky.model.stream") {
              const { requestId, phase, delta } = event.payload.data;
              if (phase === "start" && typeof requestId === "string") {
                if (messageOpen)
                  await send({
                    type: "TEXT_MESSAGE_END",
                    messageId: streamMessageId,
                  });
                streamMessageId = "model-stream:" + requestId;
                streamText = "";
                messageOpen = true;
                await send({
                  type: "TEXT_MESSAGE_START",
                  messageId: streamMessageId,
                  role: "assistant",
                });
              } else if (
                phase === "delta" &&
                messageOpen &&
                typeof delta === "string"
              ) {
                streamText += delta;
                await send({
                  type: "TEXT_MESSAGE_CONTENT",
                  messageId: streamMessageId,
                  delta,
                });
              } else if (phase === "end" && messageOpen) {
                await send({
                  type: "TEXT_MESSAGE_END",
                  messageId: streamMessageId,
                });
                messageOpen = false;
              }
            }
          } else await send(event.payload.event);
        }
        if (batch.length === 1000) continue; // Drain persisted pages before terminal receipts.
        const current = service.store.get(work.id);
        if (
          [
            "waiting_approval",
            "completed",
            "failed",
            "cancelled",
            "blocked",
          ].includes(current.status)
        ) {
          if (messageOpen) {
            await send({
              type: "TEXT_MESSAGE_END",
              messageId: streamMessageId,
            });
            messageOpen = false;
          }
          if (current.answer && current.answer !== streamText) {
            const messageId = "work-result:" + work.id;
            await send({
              type: "TEXT_MESSAGE_START",
              messageId,
              role: "assistant",
            });
            await send({
              type: "TEXT_MESSAGE_CONTENT",
              messageId,
              delta: current.answer,
            });
            await send({ type: "TEXT_MESSAGE_END", messageId });
          }
          if (current.status === "failed")
            await send({
              type: "RUN_ERROR",
              message: current.error ?? "Work failed",
              code: "work_failed",
            });
          else
            await send({
              type: "RUN_FINISHED",
              threadId: input.threadId,
              runId: input.runId,
            });
          break;
        }
        await stream.sleep(50);
      }
    });
  });
  app.use("/*", serveStatic({ root: "dist/web" }));
  app.get("*", serveStatic({ path: "dist/web/index.html" }));
  return app;
}
