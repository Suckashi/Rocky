import { randomUUID } from "node:crypto";
import type { WorkService } from "./work-service.js";
import { RockyError } from "../../../packages/contracts/src/index.js";
import { learningAutomationSchema } from "../../../packages/contracts/src/learning.js";
import { z } from "zod";
import type { Store } from "./store.js";
export function assertAutomaticAuthorization(
  store: Store,
  identity: { reflectionWorkId?: string; evaluationId?: string },
) {
  const row = identity.reflectionWorkId
    ? (store.db
        .prepare(
          "SELECT policy_revision FROM learning_automation WHERE json_extract(data,'$.reflectionWorkId')=?",
        )
        .get(identity.reflectionWorkId) as
        { policy_revision: number } | undefined)
    : (store.db
        .prepare(
          "SELECT a.policy_revision FROM learning_automation a,json_each(a.data,'$.evaluations') e WHERE json_extract(e.value,'$.evaluationId')=?",
        )
        .get(identity.evaluationId ?? "") as
        { policy_revision: number } | undefined);
  if (!row) return;
  const policy = store.db
    .prepare("SELECT data FROM learning_policy WHERE id=1")
    .get() as { data: string } | undefined;
  const value = policy ? JSON.parse(policy.data) : null;
  if (value?.mode !== "propose" || value.revision !== row.policy_revision)
    throw new RockyError(
      "learning_policy_changed",
      "Automatic Learning authorization changed",
      403,
    );
}
type RecordState = {
  sourceWorkId: string;
  policyRevision: number;
  episodeRequestId: string;
  reflectionRequestId: string;
  episodeId?: string;
  reflectionWorkId?: string;
  state: "pending" | "reflecting" | "evaluating" | "completed" | "failed";
  error: string | null;
  createdAt: string;
  config: z.infer<typeof learningAutomationSchema>;
  evaluations: Record<string, { requestId: string; evaluationId?: string }>;
};
export class LearningAutomation {
  lastError: string | null = null;
  private timer?: ReturnType<typeof setInterval>;
  private pending?: Promise<void>;
  private closing = false;
  constructor(private readonly service: WorkService) {}
  start() {
    this.timer = setInterval(() => {
      if (!this.pending && !this.closing) {
        this.pending = this.tick()
          .then(() => {
            this.lastError = null;
          })
          .catch((error) => {
            this.lastError =
              error instanceof Error
                ? error.message
                : "Automatic Learning scheduler failed";
          })
          .finally(() => {
            this.pending = undefined;
          });
      }
    }, 15000);
    this.timer.unref();
  }
  private save(value: RecordState) {
    this.service.store.db
      .prepare(
        "INSERT INTO learning_automation VALUES(?,?,?) ON CONFLICT(source_work_id,policy_revision) DO UPDATE SET data=excluded.data",
      )
      .run(value.sourceWorkId, value.policyRevision, JSON.stringify(value));
  }
  list(before?: string) {
    const cursor = before
      ? z.coerce
          .number()
          .int()
          .positive()
          .max(Number.MAX_SAFE_INTEGER)
          .parse(before)
      : Number.MAX_SAFE_INTEGER;
    const rows = this.service.store.db
      .prepare(
        "SELECT rowid,data FROM learning_automation WHERE rowid<? ORDER BY rowid DESC LIMIT 51",
      )
      .all(cursor) as { rowid: number; data: string }[];
    return {
      items: rows.slice(0, 50).map((row) => {
        const value = JSON.parse(row.data) as RecordState;
        return { ...value, config: undefined };
      }),
      nextBefore: rows.length > 50 ? String(rows[49]!.rowid) : null,
      error: this.lastError,
    };
  }
  async tick() {
    const policy = this.service.learning.policy(),
      config = policy.automation;
    if (this.closing) return;
    if (policy.mode === "propose" && config) {
      const since = new Date(Date.now() - 86400000).toISOString();
      let count = (
        this.service.store.db
          .prepare(
            "SELECT count(*) AS n FROM learning_automation WHERE json_extract(data,'$.createdAt')>=?",
          )
          .get(since) as { n: number }
      ).n;
      for (const work of this.service.store.list()) {
        if (
          count >= config.maxEpisodesPerDay ||
          work.createdAt < (policy.updatedAt ?? "") ||
          work.status !== "completed" ||
          work.runMode !== "normal"
        )
          continue;
        if (
          this.service.store.db
            .prepare(
              "SELECT 1 FROM learning_automation WHERE source_work_id=? AND policy_revision=?",
            )
            .get(work.id, policy.revision)
        )
          continue;
        try {
          this.service.learning.assertSourceAllowed(work.id, "automatic");
        } catch {
          continue;
        }
        const events = this.service.store.eventsForWork(work.id);
        const evidence = events.filter(
          (event) =>
            event.payload.kind === "domain" &&
            [
              "rocky.operation.succeeded",
              "rocky.operation.failed_no_effect",
              "rocky.tool.completed",
              "rocky.tool.failed",
              "rocky.artifact.published",
              "rocky.steering.updated",
            ].includes(event.payload.name),
        );
        const verified = evidence.some(
          (event) =>
            event.payload.kind === "domain" &&
            ["rocky.operation.succeeded", "rocky.artifact.published"].includes(
              event.payload.name,
            ),
        );
        if (!verified || evidence.length < 2) continue;
        const record: RecordState = {
          sourceWorkId: work.id,
          policyRevision: policy.revision,
          episodeRequestId: randomUUID(),
          reflectionRequestId: randomUUID(),
          state: "pending",
          error: null,
          createdAt: new Date().toISOString(),
          config,
          evaluations: {},
        };
        this.save(record);
        count++;
      }
    }
    const rows = this.service.store.db
      .prepare(
        "SELECT data FROM learning_automation WHERE json_extract(data,'$.state') IN ('pending','reflecting','evaluating') ORDER BY rowid",
      )
      .all() as { data: string }[];
    for (const row of rows) {
      if (this.closing) return;
      const record = JSON.parse(row.data) as RecordState;
      try {
        if (
          policy.mode !== "propose" ||
          policy.revision !== record.policyRevision
        )
          throw new RockyError(
            "learning_policy_changed",
            "Automatic Learning policy changed; no further calls are authorized",
            409,
          );
        this.service.learning.assertSourceAllowed(
          record.sourceWorkId,
          "automatic",
        );
        if (record.state === "pending") {
          const work = this.service.store.get(record.sourceWorkId),
            consent = this.service.learning.workConsent(work.id),
            events = this.service.store.eventsForWork(work.id);
          const selected = events
            .filter(
              (event) =>
                event.payload.kind === "domain" &&
                [
                  "rocky.operation.succeeded",
                  "rocky.operation.failed_no_effect",
                  "rocky.tool.completed",
                  "rocky.tool.failed",
                  "rocky.artifact.published",
                  "rocky.steering.updated",
                ].includes(event.payload.name),
            )
            .slice(-30);
          const corrections = selected
            .flatMap((event) => {
              const data =
                event.payload.kind === "domain" ? event.payload.data : null;
              const receipt = data?.receipt as
                { status?: string; text?: string } | undefined;
              return receipt?.status === "applied" && receipt.text
                ? [receipt.text.slice(0, 2000)]
                : [];
            })
            .slice(-10);
          const failures = selected.filter(
            (event) =>
              event.payload.kind === "domain" &&
              event.payload.name === "rocky.tool.failed",
          );
          const episode = this.service.learning.createEpisode(
            {
              requestId: record.episodeRequestId,
              workId: work.id,
              expectedPolicyRevision: policy.revision,
              expectedConsentRevision: consent.revision,
              trigger: corrections.length
                ? "user_correction"
                : failures.length
                  ? "repaired_failure"
                  : "verified_multistep",
              goal: work.text.slice(0, 2000),
              constraints: [
                "Learn only procedures supported by the referenced observed receipts; never infer extra authority",
              ],
              corrections,
              verification: selected
                .filter(
                  (event) =>
                    event.payload.kind === "domain" &&
                    [
                      "rocky.operation.succeeded",
                      "rocky.artifact.published",
                    ].includes(event.payload.name),
                )
                .slice(-10)
                .map(
                  (event) =>
                    `Observed receipt ${event.id}; inspect its bounded untrusted excerpt`,
                ),
              failuresAndRepairs: failures
                .slice(-10)
                .map(
                  (event) =>
                    `Observed failure ${event.id}; source Work later completed, but causal repair must be established from evidence`,
                ),
              preconditions: [
                work.workspaceId
                  ? `Source workspace ${work.workspaceId}`
                  : "No registered source workspace",
              ],
              evidenceEventIds: selected.map((event) => event.id),
            },
            "automatic",
          );
          record.episodeId = episode.id;
          this.save(record);
          const reflection = this.service.reflect({
            requestId: record.reflectionRequestId,
            binding: {
              episodeId: episode.id,
              episodeRevision: episode.revision,
              episodeHash: episode.contentHash,
            },
            modelSelection: record.config.modelSelection,
            modelBudget: record.config.reflectionBudget,
          });
          record.reflectionWorkId = reflection.id;
          record.state = "reflecting";
          this.save(record);
        }
        if (record.state === "reflecting") {
          const reflection = this.service.store.get(record.reflectionWorkId!);
          if (
            ["queued", "running", "waiting_approval"].includes(
              reflection.status,
            )
          )
            continue;
          if (reflection.status !== "completed")
            throw Error(
              `Reflection ended ${reflection.status}; retry requires an owner action`,
            );
          record.state = "evaluating";
          this.save(record);
        }
        if (record.state === "evaluating") {
          const candidates = this.service.store.db
            .prepare(
              "SELECT id FROM skill_candidates WHERE json_extract(data,'$.binding.episodeId')=? ORDER BY rowid",
            )
            .all(record.episodeId!) as { id: string }[];
          let complete = true;
          for (const { id } of candidates) {
            const candidate = this.service.candidates.get(id);
            if (!record.evaluations[id]) {
              record.evaluations[id] = { requestId: randomUUID() };
              this.save(record);
            }
            const entry = record.evaluations[id]!;
            if (!entry.evaluationId) {
              if (candidate.status !== "draft")
                throw Error(
                  "Candidate changed before automatic evaluation; owner review is required",
                );
              const evaluation = this.service.evaluations.start(id, {
                requestId: entry.requestId,
                expectedRevision: candidate.revision,
                candidateHash: candidate.candidateHash,
                suiteId: record.config.suiteId,
                suiteRevision: record.config.suiteRevision,
                suiteHash: record.config.suiteHash,
                target: record.config.evaluationTarget,
              });
              entry.evaluationId = evaluation.id;
              this.save(record);
              complete = false;
              break;
            }
            const evaluation = this.service.evaluations.get(entry.evaluationId);
            if (["queued", "running"].includes(evaluation.status)) {
              complete = false;
              break;
            }
          }
          if (complete) {
            record.state = "completed";
            this.save(record);
          }
        }
      } catch (error) {
        if (
          error instanceof RockyError &&
          ["evaluation_busy", "capacity"].includes(error.code)
        )
          continue;
        record.state = "failed";
        record.error =
          error instanceof Error ? error.message : "Automatic Learning failed";
        this.save(record);
        if (record.reflectionWorkId) {
          const work = this.service.store.get(record.reflectionWorkId);
          if (["queued", "running", "waiting_approval"].includes(work.status))
            this.service.stop(work.id, {
              requestId: randomUUID(),
              runId: work.runId,
              executionSessionId: work.executionSessionId,
              expectedRevision: work.revision,
            });
        }
        for (const entry of Object.values(record.evaluations))
          if (entry.evaluationId)
            await this.service.evaluations
              .stop(entry.evaluationId)
              .catch(() => undefined);
      }
    }
  }
  async close() {
    this.closing = true;
    clearInterval(this.timer);
    await this.pending;
  }
}
