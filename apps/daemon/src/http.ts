import { Hono, type Context } from "hono";
import { streamSSE } from "hono/streaming";
import { serveStatic } from "@hono/node-server/serve-static";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { RunAgentInputSchema, EventSchemas } from "@ag-ui/core/schemas";
import {
  RockyError,
  errorSchema,
  sequenceSchema,
} from "../../../packages/contracts/src/index.js";
import { WorkService } from "./work-service.js";
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
    if (Number(c.req.header("content-length") ?? 0) > 65536)
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
          if (size > 65536) {
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
        runtimeAvailable: false,
        connectionProbing: true,
      },
      fixture: { available: true },
      learning: { mode: "off" },
      remote: { created: false },
    }),
  );
  app.get("/api/v1/works", (c) => c.json({ works: service.store.list() }));
  app.get("/api/v1/works/:id/model-usage", (c) =>
    c.json(
      service.modelBudgets.snapshot(service.store.get(c.req.param("id")).runId),
    ),
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
  app.post("/api/v1/conversation/messages", async (c) =>
    c.json(service.submit(await readJson(c)), 202),
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
            data: JSON.stringify(event),
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
        mode: z.literal("fixture"),
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
        EventSchemas.parse(event);
        await stream.writeSSE({ data: JSON.stringify(event) });
      };
      await send({
        type: "RUN_STARTED",
        threadId: input.threadId,
        runId: input.runId,
      });
      let after = "0",
        done = false;
      stream.onAbort(() => {
        done = true;
      });
      while (!done) {
        for (const event of service.store.events(after)) {
          after = event.sequence;
          if (event.workId !== work.id) continue;
          if (event.payload.kind === "domain")
            await send({
              type: "CUSTOM",
              name: event.payload.name,
              value: event,
            });
          else await send(event.payload.event);
        }
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
          if (current.answer) {
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
