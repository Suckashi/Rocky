import {
  learningPolicySchema,
  learningPolicyCommandSchema,
  learningWorkConsentSchema,
  learningWorkConsentCommandSchema,
  learningEpisodeCommandSchema,
} from "../../../packages/contracts/src/learning.js";
import { RockyError } from "../../../packages/contracts/src/index.js";
import { intentHash } from "./intent.js";
import type { Store } from "./store.js";
import type { WorkspaceRegistry } from "./workspaces.js";
import { randomUUID } from "node:crypto";
import {
  completionSchema,
  publicEventSchema,
} from "../../../packages/contracts/src/index.js";
export class LearningRegistry {
  constructor(
    private readonly store: Store,
    private readonly workspaces: WorkspaceRegistry,
  ) {}
  createEpisode(input: unknown) {
    const command = learningEpisodeCommandSchema.parse(input);
    return this.store.transaction(() => {
      const { work, consent, policy } = this.assertSourceAllowed(
        command.workId,
        "manual",
      );
      const hash = intentHash(command);
      const prior = this.store.db
        .prepare("SELECT id,intent FROM learning_episodes WHERE request_id=?")
        .get(command.requestId) as { id: string; intent: string } | undefined;
      if (prior) {
        if (prior.intent !== hash)
          throw new RockyError(
            "idempotency_conflict",
            "Episode request changed",
            409,
          );
        return this.episode(prior.id);
      }
      if (
        consent.revision !== command.expectedConsentRevision ||
        policy.revision !== command.expectedPolicyRevision
      )
        throw new RockyError(
          "learning_revision",
          "Learning consent or policy changed",
          409,
        );
      const terminalRow = this.store.db
        .prepare("SELECT data FROM completion_messages WHERE work_id=?")
        .get(work.id) as { data: string } | undefined;
      if (!terminalRow)
        throw new RockyError(
          "learning_terminal",
          "Durable terminal receipt is not available",
          409,
        );
      const terminal = completionSchema.parse(JSON.parse(terminalRow.data));
      if (terminal.runId !== work.runId || terminal.status !== "completed")
        throw new RockyError(
          "learning_terminal",
          "Source terminal receipt does not match",
          409,
        );
      const sourceKey = intentHash([
        work.runId,
        terminal.sequence,
        policy.revision,
      ]);
      if (
        this.store.db
          .prepare("SELECT 1 FROM learning_episodes WHERE source_key=?")
          .get(sourceKey)
      )
        throw new RockyError(
          "learning_duplicate",
          "An episode already exists for this run, terminal boundary and policy",
          409,
        );
      const evidence = command.evidenceEventIds.map((id) => {
        const row = this.store.db
          .prepare(
            "SELECT data,CAST(sequence AS TEXT) AS sequence FROM events WHERE json_extract(data,'$.id')=?",
          )
          .get(id) as { data: string; sequence: string } | undefined;
        if (!row)
          throw new RockyError(
            "learning_evidence",
            "Evidence event not found",
            404,
          );
        const event = publicEventSchema.parse({
          ...JSON.parse(row.data),
          sequence: row.sequence,
        });
        if (
          event.workId !== work.id ||
          event.runId !== work.runId ||
          BigInt(event.sequence) > BigInt(terminal.sequence) ||
          event.payload.kind !== "domain" ||
          ![
            "rocky.tool.completed",
            "rocky.tool.failed",
            "rocky.operation.succeeded",
            "rocky.operation.failed_no_effect",
            "rocky.artifact.published",
            "rocky.steering.updated",
          ].includes(event.payload.name)
        )
          throw new RockyError(
            "learning_evidence",
            "Evidence is outside the source boundary or not an observed action",
            403,
          );
        return {
          id: event.id,
          sequence: event.sequence,
          name: event.payload.name,
        };
      });
      if (new Set(command.evidenceEventIds).size !== evidence.length)
        throw new RockyError(
          "learning_evidence",
          "Duplicate evidence references",
          422,
        );
      const safe = this.store.publicEvidence({
        goal: command.goal,
        constraints: command.constraints,
        corrections: command.corrections,
        verification: command.verification,
        failuresAndRepairs: command.failuresAndRepairs,
        preconditions: command.preconditions,
      });
      const episode = {
        id: randomUUID(),
        workId: work.id,
        sourceRunId: work.runId,
        terminalBoundarySequence: terminal.sequence,
        learningPolicyRevision: policy.revision,
        consentRevision: consent.revision,
        scope: work.workspaceId
          ? { kind: "project", projectId: work.workspaceId }
          : { kind: "user" },
        trigger: command.trigger,
        summary: safe,
        evidence,
        status: "pending_review",
        summaryAuthority: "owner_provided_not_independently_verified",
        createdAt: new Date().toISOString(),
      };
      this.store.db
        .prepare("INSERT INTO learning_episodes VALUES(?,?,?,?,?)")
        .run(
          episode.id,
          sourceKey,
          command.requestId,
          hash,
          JSON.stringify(episode),
        );
      return episode;
    });
  }
  episode(id: string) {
    const row = this.store.db
      .prepare("SELECT data FROM learning_episodes WHERE id=?")
      .get(id) as { data: string } | undefined;
    if (!row)
      throw new RockyError("not_found", "Learning episode not found", 404);
    const value = JSON.parse(row.data) as { workId: string; status: string };
    this.assertSourceAllowed(value.workId, "manual");
    if (value.status === "withdrawn")
      throw new RockyError(
        "learning_withdrawn",
        "Learning episode was withdrawn and its summary removed",
        410,
      );
    return this.store.publicEvidence(value);
  }
  workConsent(workId: string) {
    this.store.get(workId);
    const row = this.store.db
      .prepare("SELECT data FROM learning_work_consent WHERE work_id=?")
      .get(workId) as { data: string } | undefined;
    return learningWorkConsentSchema.parse(
      row
        ? JSON.parse(row.data)
        : {
            workId,
            revision: 0,
            private: false,
            excluded: true,
            sourceReuseAllowed: false,
            updatedAt: null,
          },
    );
  }
  saveWorkConsent(workId: string, input: unknown) {
    const command = learningWorkConsentCommandSchema.parse(input),
      hash = intentHash({ workId, ...command });
    return this.store.transaction(() => {
      const prior = this.store.db
        .prepare(
          "SELECT intent,result FROM learning_work_receipts WHERE request_id=?",
        )
        .get(command.requestId) as
        { intent: string; result: string } | undefined;
      if (prior) {
        if (prior.intent !== hash)
          throw new RockyError(
            "idempotency_conflict",
            "Learning consent request changed",
            409,
          );
        return learningWorkConsentSchema.parse(JSON.parse(prior.result));
      }
      const old = this.workConsent(workId);
      if (old.revision !== command.expectedRevision)
        throw new RockyError(
          "stale_learning_consent",
          "Learning work consent changed",
          409,
        );
      const result = learningWorkConsentSchema.parse({
        workId,
        revision: old.revision + 1,
        private: command.private,
        excluded: command.excluded,
        sourceReuseAllowed: command.sourceReuseAllowed,
        updatedAt: new Date().toISOString(),
      });
      this.store.db
        .prepare(
          "INSERT INTO learning_work_consent VALUES(?,?) ON CONFLICT(work_id) DO UPDATE SET data=excluded.data",
        )
        .run(workId, JSON.stringify(result));
      if (result.private || result.excluded || !result.sourceReuseAllowed)
        this.store.db
          .prepare(
            "UPDATE learning_episodes SET data=json_set(json_remove(data,'$.summary','$.evidence'),'$.status','withdrawn','$.withdrawnAt',?,'$.withdrawalConsentRevision',?) WHERE json_extract(data,'$.workId')=? AND json_extract(data,'$.status')!='withdrawn'",
          )
          .run(result.updatedAt, result.revision, workId);
      this.store.db
        .prepare("INSERT INTO learning_work_receipts VALUES(?,?,?)")
        .run(command.requestId, hash, JSON.stringify(result));
      return result;
    });
  }
  // Shared admission preflight, not proof that a reusable episode exists.
  assertSourceAllowed(workId: string, mode: "manual" | "automatic") {
    const work = this.store.get(workId),
      consent = this.workConsent(workId),
      policy = this.policy();
    if (work.runMode !== "normal")
      throw new RockyError(
        "learning_source_mode",
        "Only ordinary user work may be a Learning source",
        403,
      );
    if (work.status !== "completed")
      throw new RockyError(
        "learning_source_pending",
        "Source requires a completed work; other terminal outcomes need verified-conclusion support",
        409,
      );
    if (consent.private || consent.excluded || !consent.sourceReuseAllowed)
      throw new RockyError(
        "learning_source_excluded",
        "Source privacy, exclusion or reuse consent denies Learning",
        403,
      );
    const privateGrant = this.store.db
      .prepare(
        "SELECT 1 FROM capability_grants WHERE json_extract(data,'$.workId')=? AND json_extract(data,'$.memory.includePrivate')=1 LIMIT 1",
      )
      .get(workId);
    if (privateGrant)
      throw new RockyError(
        "learning_private_memory",
        "Work authorized private memory; revoking that grant does not remove previously delivered content",
        403,
      );
    if (
      mode === "automatic" &&
      (policy.mode !== "propose" ||
        !policy.scopes.some((scope) =>
          work.workspaceId
            ? scope.kind === "project" && scope.projectId === work.workspaceId
            : scope.kind === "user",
        ))
    )
      throw new RockyError(
        "learning_scope_denied",
        "Automatic Learning is not enabled for this source scope",
        403,
      );
    return { work, consent, policy };
  }
  policy() {
    const row = this.store.db
      .prepare("SELECT data FROM learning_policy WHERE id=1")
      .get() as { data: string } | undefined;
    return learningPolicySchema.parse(
      row
        ? JSON.parse(row.data)
        : { revision: 0, mode: "off", scopes: [], updatedAt: null },
    );
  }
  savePolicy(input: unknown) {
    const command = learningPolicyCommandSchema.parse(input),
      hash = intentHash(command);
    return this.store.transaction(() => {
      const receipt = this.store.db
        .prepare(
          "SELECT intent,result FROM learning_policy_receipts WHERE request_id=?",
        )
        .get(command.requestId) as
        { intent: string; result: string } | undefined;
      if (receipt) {
        if (receipt.intent !== hash)
          throw new RockyError(
            "idempotency_conflict",
            "Learning policy request changed",
            409,
          );
        return learningPolicySchema.parse(JSON.parse(receipt.result));
      }
      const old = this.policy();
      if (old.revision !== command.expectedRevision)
        throw new RockyError(
          "stale_learning_policy",
          "Learning policy revision changed",
          409,
        );
      for (const scope of command.scopes)
        if (scope.kind === "project") this.workspaces.get(scope.projectId);
      const result = learningPolicySchema.parse({
        revision: old.revision + 1,
        mode: command.mode,
        scopes: command.scopes,
        updatedAt: new Date().toISOString(),
      });
      this.store.db
        .prepare(
          "INSERT INTO learning_policy VALUES(1,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data",
        )
        .run(JSON.stringify(result));
      this.store.db
        .prepare("INSERT INTO learning_policy_receipts VALUES(?,?,?)")
        .run(command.requestId, hash, JSON.stringify(result));
      return result;
    });
  }
}
