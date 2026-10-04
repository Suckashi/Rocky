import {
  learningPolicySchema,
  learningPolicyCommandSchema,
  learningWorkConsentSchema,
  learningWorkConsentCommandSchema,
  learningEpisodeCommandSchema,
  learningEpisodeReviewSchema,
  learningEpisodeEditSchema,
} from "../../../packages/contracts/src/learning.js";
import { RockyError } from "../../../packages/contracts/src/index.js";
import { intentHash } from "./intent.js";
import type { Store } from "./store.js";
import type { WorkspaceRegistry } from "./workspaces.js";
import { randomUUID } from "node:crypto";
import { SourceDependencies } from "./source-dependencies.js";
import {
  completionSchema,
  publicEventSchema,
} from "../../../packages/contracts/src/index.js";
export class LearningRegistry {
  constructor(
    private readonly store: Store,
    private readonly workspaces: WorkspaceRegistry,
  ) {}
  episodes(before?: string) {
    if (
      before !== undefined &&
      (!/^[1-9][0-9]{0,18}$/.test(before) ||
        BigInt(before) > 9223372036854775807n)
    )
      throw new RockyError("learning_cursor", "Invalid episode cursor", 422);
    const rows = this.store.db
      .prepare(
        "SELECT id,CAST(rowid AS TEXT) AS cursor FROM learning_episodes WHERE (? IS NULL OR rowid < CAST(? AS INTEGER)) ORDER BY rowid DESC LIMIT 21",
      )
      .all(before ?? null, before ?? null) as { id: string; cursor: string }[];
    const page = rows.slice(0, 20),
      items: unknown[] = [];
    for (const row of page) {
      try {
        items.push(this.episode(row.id));
      } catch (error) {
        if (
          !(error instanceof RockyError) ||
          ![403, 410].includes(error.status)
        )
          throw error;
      }
    }
    return { items, nextCursor: rows.length > 20 ? page.at(-1)!.cursor : null };
  }
  createEpisode(input: unknown, mode: "manual" | "automatic" = "manual") {
    const command = learningEpisodeCommandSchema.parse(input);
    if (mode === "manual" && command.trigger !== "manual_request")
      throw new RockyError(
        "learning_trigger",
        "Automatic triggers require the daemon's scoped policy path",
        403,
      );
    return this.store.transaction(() => {
      const { work, consent, policy } = this.assertSourceAllowed(
        command.workId,
        mode,
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
          excerpt: JSON.stringify(
            this.store.publicEvidence(
              Object.fromEntries(
                (event.payload.name === "rocky.steering.updated"
                  ? ["receipt"]
                  : event.payload.name.startsWith("rocky.operation.")
                    ? ["name", "operationId", "outcome", "result", "reason"]
                    : event.payload.name === "rocky.artifact.published"
                      ? ["artifact"]
                      : ["name", "callId", "child", "error"]
                )
                  .filter(
                    (key) =>
                      event.payload.kind === "domain" &&
                      Object.hasOwn(event.payload.data, key),
                  )
                  .map((key) => [
                    key,
                    event.payload.kind === "domain"
                      ? event.payload.data[key]
                      : null,
                  ]),
              ),
            ),
          ).slice(0, 2000),
          untrustedData: true,
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
      if (mode === "automatic") {
        const view = this.episode(episode.id);
        this.store.db
          .prepare("UPDATE learning_episodes SET data=? WHERE id=?")
          .run(
            JSON.stringify({
              ...episode,
              status: "approved",
              revision: 1,
              reviewedHash: view.contentHash,
              reviewedAt: new Date().toISOString(),
              reviewAuthority: "owner_scoped_propose_policy",
              reviewedPolicyRevision: policy.revision,
            }),
            episode.id,
          );
      }
      return this.episode(episode.id);
    });
  }
  episode(id: string): Record<string, unknown> & {
    id: string;
    revision: number;
    contentHash: string;
    workId: string;
    status: string;
  } {
    const row = this.store.db
      .prepare("SELECT data FROM learning_episodes WHERE id=?")
      .get(id) as { data: string } | undefined;
    if (!row)
      throw new RockyError("not_found", "Learning episode not found", 404);
    const value = JSON.parse(row.data) as Record<string, unknown> & {
      workId: string;
      status: string;
      revision?: number;
    };
    this.assertSourceAllowed(value.workId, "manual");
    if (value.status === "withdrawn")
      throw new RockyError(
        "learning_withdrawn",
        "Learning episode was withdrawn and its summary removed",
        410,
      );
    const safe = this.store.publicEvidence(value) as typeof value;
    const contentHash = intentHash({
      id,
      workId: safe.workId,
      sourceRunId: safe.sourceRunId,
      terminalBoundarySequence: safe.terminalBoundarySequence,
      learningPolicyRevision: safe.learningPolicyRevision,
      consentRevision: safe.consentRevision,
      scope: safe.scope,
      trigger: safe.trigger,
      summaryAuthority: safe.summaryAuthority,
      summary: safe.summary,
      evidence: safe.evidence,
    });
    return {
      ...safe,
      id,
      revision: safe.revision ?? 1,
      contentHash,
      status:
        safe.status === "approved" && safe.reviewedHash !== contentHash
          ? "needs_review"
          : safe.status,
    };
  }
  editEpisode(id: string, input: unknown) {
    const command = learningEpisodeEditSchema.parse(input),
      hash = intentHash({ edit: id, ...command });
    return this.store.transaction(() => {
      const prior = this.store.db
        .prepare(
          "SELECT intent,result FROM learning_review_receipts WHERE request_id=?",
        )
        .get(command.requestId) as
        { intent: string; result: string } | undefined;
      if (prior) {
        if (prior.intent !== hash)
          throw new RockyError(
            "idempotency_conflict",
            "Episode edit changed",
            409,
          );
        return JSON.parse(prior.result);
      }
      const episode = this.episode(id);
      if (
        episode.revision !== command.expectedRevision ||
        episode.contentHash !== command.contentHash
      )
        throw new RockyError(
          "learning_stale",
          "Episode changed; review the latest summary",
          409,
        );
      const raw = JSON.parse(
        (
          this.store.db
            .prepare("SELECT data FROM learning_episodes WHERE id=?")
            .get(id) as { data: string }
        ).data,
      );
      const next = {
        ...raw,
        summary: this.store.publicEvidence(command.summary),
        revision: episode.revision + 1,
        status: "pending_review",
        reviewedHash: null,
        reviewedAt: null,
        reviewAuthority: null,
      };
      this.store.db
        .prepare("UPDATE learning_episodes SET data=? WHERE id=?")
        .run(JSON.stringify(next), id);
      this.invalidateDerived(episode.workId, id, "Source episode edited");
      const result = this.episode(id);
      this.store.db
        .prepare("INSERT INTO learning_review_receipts VALUES(?,?,?)")
        .run(
          command.requestId,
          hash,
          JSON.stringify({
            id: result.id,
            revision: result.revision,
            contentHash: result.contentHash,
            status: result.status,
          }),
        );
      this.store.event(
        this.store.get(episode.workId),
        "rocky.learning.episode_edited",
        {
          episodeId: id,
          revision: result.revision,
          contentHash: result.contentHash,
          priorApprovalInvalidated: true,
        },
      );
      return result;
    });
  }
  reviewEpisode(id: string, input: unknown) {
    const command = learningEpisodeReviewSchema.parse(input),
      hash = intentHash({ id, ...command });
    return this.store.transaction(() => {
      const prior = this.store.db
        .prepare(
          "SELECT intent,result FROM learning_review_receipts WHERE request_id=?",
        )
        .get(command.requestId) as
        { intent: string; result: string } | undefined;
      if (prior) {
        if (prior.intent !== hash)
          throw new RockyError(
            "idempotency_conflict",
            "Episode review request changed",
            409,
          );
        return JSON.parse(prior.result);
      }
      const view = this.episode(id);
      if (
        view.revision !== command.expectedRevision ||
        view.contentHash !== command.contentHash ||
        !["pending_review", "needs_review"].includes(view.status)
      )
        throw new RockyError(
          "learning_review_stale",
          "Episode review content or status changed",
          409,
        );
      const row = this.store.db
        .prepare("SELECT data FROM learning_episodes WHERE id=?")
        .get(id) as { data: string };
      const data = JSON.parse(row.data) as Record<string, unknown>;
      const result = {
        id,
        revision: view.revision + 1,
        status: command.decision === "approve" ? "approved" : "rejected",
        reviewedHash: view.contentHash,
        reviewedAt: new Date().toISOString(),
        reviewAuthority: "owner_exact_episode",
      };
      this.store.db
        .prepare("UPDATE learning_episodes SET data=? WHERE id=?")
        .run(JSON.stringify({ ...data, ...result }), id);
      this.store.db
        .prepare("INSERT INTO learning_review_receipts VALUES(?,?,?)")
        .run(command.requestId, hash, JSON.stringify(result));
      return result;
    });
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
      if (result.private || result.excluded || !result.sourceReuseAllowed)
        this.store.db
          .prepare(
            "UPDATE learning_reflection_outputs SET data=json_remove(json_set(data,'$.status','withdrawn'),'$.payload') WHERE json_extract(data,'$.sourceWorkId')=?",
          )
          .run(workId);
      if (result.private || result.excluded || !result.sourceReuseAllowed)
        this.invalidateDerived(workId);
      return result;
    });
  }
  invalidateDerived(
    workId: string,
    episodeId?: string,
    cause = "Source consent withdrawn",
  ) {
    this.store.db
      .prepare(
        "UPDATE learning_reflection_outputs SET data=json_remove(json_set(data,'$.status','withdrawn'),'$.payload') WHERE json_extract(data,'$.sourceWorkId')=? AND (? IS NULL OR json_extract(data,'$.episodeId')=?)",
      )
      .run(workId, episodeId ?? null, episodeId ?? null);
    const candidates = this.store.db
      .prepare(
        "SELECT id,data FROM skill_candidates WHERE json_extract(data,'$.sourceWorkId')=? AND (? IS NULL OR json_extract(data,'$.binding.episodeId')=?)",
      )
      .all(workId, episodeId ?? null, episodeId ?? null) as {
      id: string;
      data: string;
    }[];
    for (const row of candidates) {
      const candidate = JSON.parse(row.data);
      if (String(candidate.reason ?? "").includes("derived content removed"))
        continue;
      this.store.db
        .prepare(
          "UPDATE learning_evaluations SET invalidated=1,data=json_set(data,'$.verdict','insufficient_evidence','$.reason','Source consent withdrawn','$.results',json('[]')) WHERE candidate_id=?",
        )
        .run(row.id);
      const revisions = this.store.db
        .prepare(
          "SELECT id,revision,data FROM skill_revisions WHERE json_extract(data,'$.learning.proposalId')=?",
        )
        .all(row.id) as { id: string; revision: number; data: string }[];
      for (const revision of revisions) {
        const skill = JSON.parse(revision.data);
        this.store.db
          .prepare("INSERT OR IGNORE INTO skill_quarantine VALUES(?,?)")
          .run(revision.id, skill.contentHash);
        new SourceDependencies(this.store).invalidate(
          "skill",
          revision.id,
          "learning_source_withdrawn",
          revision.revision,
        );
        this.store.db
          .prepare(
            "UPDATE skill_selections SET data=json_set(data,'$.state','quarantined','$.revision',json_extract(data,'$.revision')+1,'$.updatedAt',?) WHERE id=? AND json_extract(data,'$.contentHash')=? AND json_extract(data,'$.state')!='quarantined'",
          )
          .run(new Date().toISOString(), revision.id, skill.contentHash);
      }
      // Retain only identities/hashes/governance receipts. Do not delete run checkpoints,
      // operation evidence, formal immutable skills, or unrelated candidate packages.
      const removed = {
        ...candidate,
        name: "withdrawn",
        description: "Source removed",
        goal: "Source removed",
        preconditions: [],
        triggers: [],
        steps: ["Source removed"],
        stopConditions: [],
        verification: ["Source removed"],
        requiredCapabilities: [],
        knownLimitations: ["Source withdrawn; reuse prohibited"],
        status: candidate.published ? "quarantined" : "withdrawn",
        reason:
          cause +
          "; derived content removed; remote provider copies cannot be recalled",
        revision: candidate.revision + 1,
        updatedAt: new Date().toISOString(),
      };
      this.store.db
        .prepare("UPDATE skill_candidates SET data=? WHERE id=?")
        .run(JSON.stringify(removed), row.id);
      const packageHashes = new Set([
        candidate.packageHash,
        ...(
          this.store.db
            .prepare(
              "SELECT json_extract(data,'$.packageHash') AS hash FROM candidate_revisions WHERE id=?",
            )
            .all(row.id) as { hash: string }[]
        ).map((entry) => entry.hash),
      ]);
      this.store.db
        .prepare("DELETE FROM candidate_revisions WHERE id=?")
        .run(row.id);
      for (const hash of packageHashes)
        this.store.db
          .prepare(
            "DELETE FROM candidate_packages WHERE hash=? AND NOT EXISTS(SELECT 1 FROM skill_candidates WHERE id!=? AND json_extract(data,'$.packageHash')=? AND json_extract(data,'$.status') NOT IN ('withdrawn','quarantined')) AND NOT EXISTS(SELECT 1 FROM candidate_revisions WHERE json_extract(data,'$.packageHash')=?)",
          )
          .run(hash, row.id, hash, hash);
      this.store.event(
        this.store.get(workId),
        "rocky.learning.source_withdrawn",
        {
          proposalId: row.id,
          affectedSkills: revisions.map((entry) => ({
            skillId: entry.id,
            revision: entry.revision,
          })),
          checkpointsRetained: true,
          remoteDeletionConfirmed: false,
        },
      );
    }
  }
  // Shared admission preflight, not proof that a reusable episode exists.
  assertSourceAllowed(workId: string, mode: "manual" | "automatic") {
    const work = this.store.get(workId),
      consent = this.workConsent(workId),
      policy = this.policy();
    new SourceDependencies(this.store).assert(work);
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
        automation:
          command.mode === "off" ? null : (command.automation ?? null),
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
