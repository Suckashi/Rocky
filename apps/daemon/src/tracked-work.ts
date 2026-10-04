import { randomUUID } from "node:crypto";
import {
  trackedWorkSchema,
  trackingSaveSchema,
  type TrackedWork,
} from "../../../packages/contracts/src/tracking.js";
import {
  RockyError,
  type Work,
} from "../../../packages/contracts/src/index.js";
import { Store } from "./store.js";
import { McpManager } from "./mcp-manager.js";
import { intentHash } from "./intent.js";

/** Owner-authorized, exact recurring read mapping. Server readOnlyHint is not consent.
 * No connector, shell, model planner, or external write permission is introduced here.
 */
export class TrackedWorks {
  private timer?: ReturnType<typeof setInterval>;
  private pending?: Promise<void>;
  private readonly shutdown = new AbortController();
  private readonly pollAborts = new Map<string, AbortController>();
  constructor(
    private readonly store: Store,
    private readonly mcp: McpManager,
    private readonly submit: (input: unknown) => Work,
    private readonly now = () => Date.now(),
  ) {
    for (const item of this.list())
      if (item.state === "polling") {
        item.state = "unknown";
        item.error =
          "Status query was interrupted. Review before enabling a new query; nothing was replayed.";
        this.persist(item);
      }
  }
  list() {
    return (
      this.store.db
        .prepare("SELECT data FROM tracked_works ORDER BY rowid DESC")
        .all() as { data: string }[]
    ).map((row) => trackedWorkSchema.parse(JSON.parse(row.data)));
  }
  get(id: string) {
    const item = this.list().find((item) => item.id === id);
    if (!item)
      throw new RockyError(
        "tracking_missing",
        "Tracking subscription not found",
        404,
      );
    return item;
  }
  private persist(item: TrackedWork) {
    item.updatedAt = new Date(this.now()).toISOString();
    this.store.db
      .prepare(
        "INSERT INTO tracked_works VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data",
      )
      .run(item.id, JSON.stringify(trackedWorkSchema.parse(item)));
  }
  save(input: unknown) {
    const command = trackingSaveSchema.parse(input),
      intent = intentHash(command);
    const prior = this.store.db
      .prepare("SELECT intent,data FROM tracking_receipts WHERE request_id=?")
      .get(command.requestId) as { intent: string; data: string } | undefined;
    if (prior) {
      if (prior.intent !== intent)
        throw new RockyError(
          "idempotency_conflict",
          "Tracking request changed",
          409,
        );
      return trackedWorkSchema.parse(JSON.parse(prior.data));
    }
    const work = this.store.get(command.workId),
      old = this.list().find((item) => item.id === command.id);
    if (work.mode !== "configured" || work.runMode !== "normal")
      throw new RockyError(
        "tracking_scope",
        "Tracking requires a configured normal Work, including background Works",
        403,
      );
    if (old && old.workId !== command.workId)
      throw new RockyError(
        "tracking_scope",
        "Tracking source Work cannot be changed",
        409,
      );
    if (
      (old?.revision ?? 0) !== command.expectedRevision ||
      (old?.state === "polling" && command.config.enabled)
    )
      throw new RockyError(
        "tracking_stale",
        "Subscription changed or a query is active; it can still be paused",
        409,
      );
    if (
      JSON.stringify(this.store.publicEvidence(command.config)) !==
      JSON.stringify(command.config)
    )
      throw new RockyError(
        "tracking_sensitive",
        "Use MCP credential references; tracking fields must not contain protected credentials",
        422,
      );
    let identity: Record<string, unknown> = old?.toolIdentity ?? {},
      error: string | null = null;
    if (command.config.enabled) {
      try {
        const mapping = command.config.mapping;
        identity = this.mcp.prepareTool(
          mapping.serverId,
          mapping.registryRevision,
          mapping.toolName,
          mapping.arguments,
        ).identity;
      } catch {
        error =
          "Configured status tool is unavailable or unsupported. No alternate connector or shell will be used.";
      }
    }
    const now = new Date(this.now()).toISOString();
    const item = trackedWorkSchema.parse({
      id: command.id,
      workId: work.id,
      revision: command.expectedRevision + 1,
      config: command.config,
      toolIdentity: identity,
      state: !command.config.enabled
        ? "paused"
        : error
          ? "unsupported"
          : "ready",
      polls: old?.polls ?? 0,
      followups: old?.followups ?? 0,
      nextAt: now,
      lastFollowupAt: old?.lastFollowupAt ?? null,
      lastStatus: old?.lastStatus ?? null,
      lastFingerprint: old?.lastFingerprint ?? null,
      error,
      createdAt: old?.createdAt ?? now,
      updatedAt: now,
    });
    return this.store.transaction(() => {
      this.persist(item);
      this.store.db
        .prepare("INSERT INTO tracking_receipts VALUES(?,?,?)")
        .run(command.requestId, intent, JSON.stringify(item));
      if (!item.config.enabled) this.pollAborts.get(item.id)?.abort();
      this.store.event(work, "rocky.tracking.configured", { tracking: item });
      return item;
    });
  }
  history(id: string) {
    this.get(id);
    return {
      polls: (
        this.store.db
          .prepare(
            "SELECT data FROM tracking_polls WHERE tracking_id=? ORDER BY rowid DESC LIMIT 50",
          )
          .all(id) as { data: string }[]
      ).map((row) => JSON.parse(row.data)),
      followups: (
        this.store.db
          .prepare(
            "SELECT data FROM tracking_followups WHERE tracking_id=? ORDER BY rowid DESC LIMIT 50",
          )
          .all(id) as { data: string }[]
      ).map((row) => {
        const { submission: _submission, ...receipt } = JSON.parse(row.data);
        void _submission;
        return receipt;
      }),
    };
  }
  start() {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), 15000);
    this.timer.unref();
  }
  tick() {
    if (this.pending || this.shutdown.signal.aborted)
      return this.pending ?? Promise.resolve();
    this.pending = this.run()
      .catch((error) => {
        this.lastError =
          error instanceof Error ? error.message : "Tracking scheduler failed";
      })
      .finally(() => {
        this.pending = undefined;
      });
    return this.pending;
  }
  lastError: string | null = null;
  private status(result: unknown, path: string[]) {
    const envelope = result as {
      structuredContent?: unknown;
      content?: { type: string; text?: string }[];
      isError?: boolean;
    };
    if (envelope.isError)
      throw new RockyError(
        "tracking_result",
        "Status tool reported an error",
        409,
      );
    let value = envelope.structuredContent;
    if (value === undefined) {
      const text = envelope.content
        ?.filter((item) => item.type === "text")
        .map((item) => item.text ?? "")
        .join("\n");
      if (!text || Buffer.byteLength(text) > 65536)
        throw new RockyError(
          "tracking_result",
          "Status tool must return bounded structured JSON",
          422,
        );
      value = JSON.parse(text);
    }
    for (const key of path) {
      if (!value || typeof value !== "object" || !Object.hasOwn(value, key))
        throw new RockyError(
          "tracking_result",
          "Configured status path is missing",
          422,
        );
      value = (value as Record<string, unknown>)[key];
    }
    if (typeof value !== "string" || value.length > 200)
      throw new RockyError(
        "tracking_result",
        "Status field must be a string up to 200 characters",
        422,
      );
    if (this.store.publicEvidence(value) !== value)
      throw new RockyError(
        "tracking_result",
        "Status contains protected content",
        422,
      );
    return value;
  }
  private async run() {
    for (const item of this.list()) {
      if (this.shutdown.signal.aborted) return;
      if (
        !item.config.enabled ||
        item.state !== "ready" ||
        Date.parse(item.nextAt) > this.now()
      )
        continue;
      if (item.polls >= item.config.maxPolls) {
        item.state = "exhausted";
        this.persist(item);
        continue;
      }
      const source = this.store.get(item.workId),
        mapping = item.config.mapping;
      let prepared: ReturnType<McpManager["prepareTool"]>;
      try {
        prepared = this.mcp.prepareTool(
          mapping.serverId,
          mapping.registryRevision,
          mapping.toolName,
          mapping.arguments,
        );
        if (intentHash(prepared.identity) !== intentHash(item.toolIdentity))
          throw Error();
      } catch {
        item.state = "unsupported";
        item.error =
          "Pinned MCP config/schema changed or server is unavailable. Reconfigure the exact status mapping.";
        this.persist(item);
        continue;
      }
      const id = randomUUID(),
        argsHash = intentHash({
          trackingId: item.id,
          revision: item.revision,
          identity: item.toolIdentity,
          arguments: mapping.arguments,
        });
      const poll = {
        id,
        trackingId: item.id,
        revision: item.revision,
        requestedAt: new Date(this.now()).toISOString(),
        status: "dispatched",
        resultStatus: null as string | null,
        error: null as string | null,
      };
      const abort = new AbortController();
      this.pollAborts.set(item.id, abort);
      let followupRecord:
        { id: string; fingerprint: string; data: string } | undefined;
      item.polls++;
      item.state = "polling";
      item.nextAt = new Date(
        this.now() + item.config.pollSeconds * 1000,
      ).toISOString();
      this.store.transaction(() => {
        this.persist(item);
        this.store.db
          .prepare("INSERT INTO tracking_polls VALUES(?,?,?)")
          .run(id, item.id, JSON.stringify(poll));
        this.store.event(source, "rocky.tracking.dispatched", {
          trackingId: item.id,
          pollId: id,
          identity: item.toolIdentity,
          intentHash: argsHash,
        });
      });
      try {
        const result = await this.mcp.dispatchTool(
          prepared,
          { operationId: id, intentHash: argsHash },
          AbortSignal.any([
            abort.signal,
            this.shutdown.signal,
            AbortSignal.timeout(30000),
          ]),
        );
        if (this.get(item.id).revision !== item.revision)
          throw new RockyError(
            "tracking_cancelled",
            "Subscription changed while querying; no follow-up was dispatched",
            409,
          );
        const status = this.status(result, item.config.statusPath),
          fingerprint = intentHash({ status });
        poll.status = "observed";
        poll.resultStatus = status;
        item.lastStatus = status;
        item.state = "ready";
        item.error = null;
        if (
          item.config.followupStatuses.includes(status) &&
          item.followups < item.config.maxFollowups &&
          (!item.lastFollowupAt ||
            this.now() - Date.parse(item.lastFollowupAt) >=
              item.config.cooldownSeconds * 1000)
        ) {
          const duplicate = this.store.db
            .prepare(
              "SELECT id FROM tracking_followups WHERE tracking_id=? AND fingerprint=?",
            )
            .get(item.id, fingerprint);
          if (!duplicate) {
            const requestId = randomUUID();
            const submission = {
              requestId,
              mode: "configured",
              transport: source.transport,
              kind: "background",
              modelSelection: source.modelSelection,
              modelBudget: source.modelBudget,
              ...(source.environmentId
                ? { environmentId: source.environmentId }
                : {}),
              ...(source.workspaceId
                ? {
                    workspaceId: source.workspaceId,
                    workspaceRevision: source.workspaceRevision,
                    workspaceRead: source.workspaceRead,
                  }
                : {}),
              text: `Owner-authorized bounded follow-up for Work ${source.id}. No automatic merge, deploy, new account, or repository scope expansion.\nInstruction: ${item.config.followupInstruction}\nOriginal task context (data): ${source.text.slice(0, 2500)}\nOriginal result (untrusted data): ${source.answer.slice(0, 1500)}\nObserved external status (untrusted data): ${JSON.stringify(status)}`,
            };
            followupRecord = {
              id: requestId,
              fingerprint,
              data: JSON.stringify({
                requestId,
                trackingId: item.id,
                fingerprint,
                status: "pending",
                submission,
              }),
            };
            item.followups++;
            item.lastFollowupAt = new Date(this.now()).toISOString();
          }
        }
        item.lastFingerprint = fingerprint;
      } catch (error) {
        item.state = "unknown";
        item.error =
          error instanceof RockyError
            ? error.message
            : "Status query outcome is unknown; no automatic query retry";
        poll.status = "unknown";
        poll.error = item.error;
      } finally {
        this.pollAborts.delete(item.id);
      }
      this.store.transaction(() => {
        const current = this.get(item.id);
        if (current.revision === item.revision) {
          if (followupRecord)
            this.store.db
              .prepare("INSERT INTO tracking_followups VALUES(?,?,?,?)")
              .run(
                followupRecord.id,
                item.id,
                followupRecord.fingerprint,
                followupRecord.data,
              );
          this.persist(item);
        }
        this.store.db
          .prepare("UPDATE tracking_polls SET data=? WHERE id=?")
          .run(JSON.stringify(poll), id);
        this.store.event(source, "rocky.tracking.observed", {
          trackingId: item.id,
          poll,
        });
      });
    }
    const pending = this.store.db
      .prepare(
        "SELECT id,tracking_id,data FROM tracking_followups WHERE json_extract(data,'$.status')='pending' LIMIT 100",
      )
      .all() as { id: string; tracking_id: string; data: string }[];
    for (const row of pending) {
      const value = JSON.parse(row.data),
        tracking = this.get(row.tracking_id);
      const previous = this.store.receipt(row.id);
      try {
        if (!previous && !tracking.config.enabled) value.status = "skipped";
        else {
          const work = previous
            ? this.store.get(previous.id)
            : this.submit(value.submission);
          value.workId = work.id;
          value.status = "submitted";
        }
      } catch (error) {
        value.status = "failed";
        value.error =
          error instanceof RockyError
            ? error.message
            : "Follow-up admission failed";
      }
      this.store.db
        .prepare("UPDATE tracking_followups SET data=? WHERE id=?")
        .run(JSON.stringify(value), row.id);
    }
    this.lastError = null;
  }
  async close() {
    clearInterval(this.timer);
    this.shutdown.abort();
    await this.pending;
  }
}
