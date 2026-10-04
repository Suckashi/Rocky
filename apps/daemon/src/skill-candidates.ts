import { randomUUID } from "node:crypto";
import { z } from "zod";
import { parseDocument } from "yaml";
import {
  candidateSchema,
  candidateBaseSchema,
  candidateEditSchema,
  candidateCommandSchema,
  type SkillCandidate,
} from "../../../packages/contracts/src/learning-candidates.js";
import {
  skillCandidateDraftSchema,
  reflectionBindingSchema,
  reflectionToolSchemas,
} from "../../../packages/contracts/src/reflection.js";
import { learningScopeSchema } from "../../../packages/contracts/src/learning.js";
import { RockyError } from "../../../packages/contracts/src/index.js";
import type { Store } from "./store.js";
import type { LearningRegistry } from "./learning.js";
import type { SkillRegistry } from "./skills.js";
import { validateSkillPackage } from "./skill-package.js";
import { intentHash } from "./intent.js";
type Draft = z.infer<typeof skillCandidateDraftSchema>;
export class SkillCandidates {
  constructor(
    private readonly store: Store,
    private readonly learning: LearningRegistry,
    private readonly skills: SkillRegistry,
  ) {}
  get(id: string) {
    z.uuid().parse(id);
    const row = this.store.db
      .prepare("SELECT data FROM skill_candidates WHERE id=?")
      .get(id) as { data: string } | undefined;
    if (!row)
      throw new RockyError(
        "candidate_missing",
        "Skill candidate not found",
        404,
      );
    return candidateSchema.parse(JSON.parse(row.data));
  }
  source(candidate: SkillCandidate) {
    const episode = this.learning.episode(candidate.binding.episodeId);
    if (
      episode.status !== "approved" ||
      episode.revision !== candidate.binding.episodeRevision ||
      episode.contentHash !== candidate.binding.episodeHash ||
      episode.reviewedHash !== episode.contentHash
    )
      throw new RockyError(
        "candidate_source",
        "Candidate source consent, revision or review changed",
        409,
      );
    return episode;
  }
  page(before = Number.MAX_SAFE_INTEGER) {
    z.number().int().positive().parse(before);
    const rows = this.store.db
      .prepare(
        "SELECT rowid,data FROM skill_candidates WHERE rowid<? ORDER BY rowid DESC LIMIT 21",
      )
      .all(before) as { rowid: number; data: string }[];
    return {
      items: rows.slice(0, 20).map((row) => {
        const candidate = candidateSchema.parse(JSON.parse(row.data));
        try {
          this.source(candidate);
          return { candidate, sourceAvailable: true };
        } catch {
          return {
            candidate: {
              proposalId: candidate.proposalId,
              revision: candidate.revision,
              candidateRevision: candidate.candidateRevision,
              status: candidate.status,
              candidateHash: candidate.candidateHash,
              name: "Source unavailable",
              reason: "Source withdrawn or consent changed",
            },
            sourceAvailable: false,
          };
        }
      }),
      nextBefore: rows.length > 20 ? rows[19]!.rowid : null,
    };
  }
  history(id: string, before = Number.MAX_SAFE_INTEGER) {
    this.source(this.get(id));
    z.number().int().positive().parse(before);
    const rows = this.store.db
      .prepare(
        "SELECT sequence,data FROM candidate_events WHERE candidate_id=? AND sequence<? ORDER BY sequence DESC LIMIT 51",
      )
      .all(id, before) as { sequence: number; data: string }[];
    return {
      entries: rows
        .slice(0, 50)
        .map((row) => ({ sequence: row.sequence, ...JSON.parse(row.data) })),
      nextBefore: rows.length > 50 ? rows[49]!.sequence : null,
    };
  }
  private save(candidate: SkillCandidate, action: string) {
    const data = JSON.stringify(candidateSchema.parse(candidate));
    this.store.db
      .prepare(
        "INSERT INTO skill_candidates VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data",
      )
      .run(candidate.proposalId, data);
    this.store.db
      .prepare("INSERT OR IGNORE INTO candidate_revisions VALUES(?,?,?)")
      .run(candidate.proposalId, candidate.candidateRevision, data);
    this.store.db
      .prepare("INSERT INTO candidate_events(candidate_id,data) VALUES(?,?)")
      .run(
        candidate.proposalId,
        JSON.stringify({
          action,
          revision: candidate.revision,
          candidateRevision: candidate.candidateRevision,
          candidateHash: candidate.candidateHash,
          status: candidate.status,
          evaluationId: candidate.evaluationId,
          reason: candidate.reason,
          at: candidate.updatedAt,
        }),
      );
    this.store.event(
      this.store.get(candidate.sourceWorkId),
      "rocky.learning.candidate",
      {
        proposalId: candidate.proposalId,
        candidateRevision: candidate.candidateRevision,
        candidateHash: candidate.candidateHash,
        status: candidate.status,
      },
    );
    return candidate;
  }
  private materialize(
    draft: Draft,
    base: SkillCandidate["base"],
    patchReason?: string,
  ) {
    if (
      Buffer.byteLength(JSON.stringify(draft)) > 65536 ||
      JSON.stringify(this.store.publicEvidence(draft)) !== JSON.stringify(draft)
    )
      throw new RockyError(
        "candidate_content",
        "Candidate exceeds bounds or contains protected content",
        422,
      );
    const sections = Object.entries({
      Goal: [draft.goal],
      Preconditions: draft.preconditions,
      Triggers: draft.triggers,
      Steps: draft.steps,
      "Stop conditions": draft.stopConditions,
      Verification: draft.verification,
      "Required capabilities (not grants)": draft.requiredCapabilities,
      "Known limitations": draft.knownLimitations,
      "Evidence references": draft.evidenceRefs,
    })
      .map(
        ([title, lines]) =>
          `## ${title}\n${lines.map((line) => `- ${line}`).join("\n")}`,
      )
      .join("\n\n");
    let files: { path: string; contentBase64: string }[] = [];
    let content = `---\nname: ${JSON.stringify(draft.name)}\ndescription: ${JSON.stringify(draft.description)}\n---\n\n${sections}\n`;
    if (base) {
      const prior = this.skills.get(base.skillId, base.revision);
      if (
        prior.revision.contentHash !== base.contentHash ||
        prior.revision.metadata.name !== draft.name
      )
        throw new RockyError(
          "candidate_base",
          "Patch base hash or name changed",
          409,
        );
      files = prior.package.files.map(({ path, contentBase64 }) => ({
        path,
        contentBase64,
      }));
      // Preserve every original file and body. A reviewed typed amendment is appended.
      const old = files.find((file) => file.path === "SKILL.md")!;
      const original = Buffer.from(old.contentBase64, "base64").toString(
          "utf8",
        ),
        front = /^(?:\uFEFF)?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(
          original,
        );
      if (!front)
        throw new RockyError(
          "candidate_base",
          "Base frontmatter is missing",
          409,
        );
      const metadata = parseDocument(front[1]!);
      metadata.set("description", draft.description);
      content =
        `---\n${metadata.toString()}---\n` +
        original.slice(front[0].length) +
        `\n\n# Reviewed amendment\n\nReason: ${patchReason ?? "Owner revision"}\n\n${sections}\n`;
    }
    if (this.store.publicEvidence(content) !== content)
      throw new RockyError(
        "candidate_secret",
        "Candidate package contains protected content",
        403,
      );
    files = files.filter((file) => file.path !== "SKILL.md");
    files.push({
      path: "SKILL.md",
      contentBase64: Buffer.from(content).toString("base64"),
    });
    const snapshot = validateSkillPackage({ directoryName: draft.name, files });
    this.store.db
      .prepare("INSERT OR IGNORE INTO candidate_packages VALUES(?,?)")
      .run(snapshot.contentHash, JSON.stringify(snapshot));
    return {
      packageHash: snapshot.contentHash,
      files: snapshot.files.map((file) => ({
        path: file.path,
        blobRef: `${snapshot.contentHash}:${file.path}`,
        sha256: file.sha256,
      })),
    };
  }
  package(candidate: SkillCandidate) {
    this.source(candidate);
    const row = this.store.db
      .prepare("SELECT data FROM candidate_packages WHERE hash=?")
      .get(candidate.packageHash) as { data: string } | undefined;
    if (!row)
      throw new RockyError(
        "candidate_integrity",
        "Candidate package missing",
        409,
      );
    const raw = JSON.parse(row.data),
      snapshot = validateSkillPackage({
        directoryName: candidate.name,
        files: raw.files.map(
          ({
            path,
            contentBase64,
          }: {
            path: string;
            contentBase64: string;
          }) => ({ path, contentBase64 }),
        ),
      });
    if (snapshot.contentHash !== candidate.packageHash)
      throw new RockyError(
        "candidate_integrity",
        "Candidate package hash changed",
        409,
      );
    return snapshot;
  }
  fromReflection(input: unknown) {
    if (!this.store.db.isTransaction)
      throw new RockyError(
        "candidate_transaction",
        "Proposal requires the reflection transaction",
        500,
      );
    const output = z
      .object({
        id: z.uuid(),
        episodeId: z.uuid(),
        sourceWorkId: z.uuid(),
        binding: reflectionBindingSchema,
        scope: learningScopeSchema,
        kind: z.enum(["propose_skill_create", "propose_skill_patch"]),
        payload: z.unknown(),
      })
      .parse(input);
    const existing = this.store.db
      .prepare(
        "SELECT data FROM skill_candidates WHERE json_extract(data,'$.sourceOutputId')=?",
      )
      .get(output.id) as { data: string } | undefined;
    if (existing) return candidateSchema.parse(JSON.parse(existing.data));
    const count = this.store.db
      .prepare(
        "SELECT count(*) AS n FROM skill_candidates WHERE json_extract(data,'$.binding.episodeId')=?",
      )
      .get(output.episodeId) as { n: number };
    if (count.n >= 2)
      throw new RockyError(
        "candidate_budget",
        "Episode candidate budget exhausted (maximum two)",
        429,
      );
    let base: SkillCandidate["base"] = null,
      draft: Draft,
      reason: string | undefined;
    if (output.kind === "propose_skill_create")
      draft = reflectionToolSchemas.propose_skill_create.parse(
        output.payload,
      ).candidate;
    else {
      const patch = reflectionToolSchemas.propose_skill_patch.parse(
        output.payload,
      );
      base = candidateBaseSchema.parse(patch.base);
      reason = patch.reason;
      const previous = this.skills.get(base.skillId, base.revision).revision;
      draft = skillCandidateDraftSchema.parse({
        name: previous.metadata.name,
        description: previous.metadata.description,
        goal: patch.reason,
        preconditions: [],
        triggers: [],
        stopConditions: [],
        requiredCapabilities: [],
        knownLimitations: [],
        ...patch.changes,
      });
      // Explicit steps, verification and evidence are mandatory even for a local patch.
    }
    const binding = output.binding,
      now = new Date().toISOString(),
      scope = output.scope;
    const materialized = this.materialize(draft, base, reason);
    const candidate = candidateSchema.parse({
      ...draft,
      ...materialized,
      proposalId: randomUUID(),
      revision: 1,
      candidateRevision: 1,
      candidateHash: intentHash({
        draft,
        base,
        scope,
        packageHash: materialized.packageHash,
      }),
      sourceOutputId: output.id,
      sourceWorkId: output.sourceWorkId,
      binding,
      scope,
      base,
      baseSelectionRevision: base
        ? (this.skills.selection(base.skillId)?.revision ?? 0)
        : 0,
      status: "draft",
      evaluationId: null,
      reason: null,
      published: null,
      createdAt: now,
      updatedAt: now,
    });
    const episode = this.source(candidate);
    const evidence = z
      .array(z.object({ id: z.uuid() }))
      .parse(episode.evidence);
    if (
      candidate.evidenceRefs.some(
        (id) => !evidence.some((item) => item.id === id),
      )
    )
      throw new RockyError(
        "candidate_evidence",
        "Candidate evidence is outside the episode",
        403,
      );
    return this.save(candidate, "created");
  }
  private receipt(requestId: string, intent: string) {
    const row = this.store.db
      .prepare("SELECT intent,data FROM candidate_receipts WHERE request_id=?")
      .get(requestId) as { intent: string; data: string } | undefined;
    if (row && row.intent !== intent)
      throw new RockyError(
        "idempotency_conflict",
        "Candidate command changed",
        409,
      );
    return row ? candidateSchema.parse(JSON.parse(row.data)) : undefined;
  }
  private record(requestId: string, intent: string, candidate: SkillCandidate) {
    this.store.db
      .prepare("INSERT INTO candidate_receipts VALUES(?,?,?)")
      .run(requestId, intent, JSON.stringify(candidate));
    return candidate;
  }
  private target(id: string, revision: number, hash: string) {
    const candidate = this.get(id);
    if (candidate.revision !== revision || candidate.candidateHash !== hash)
      throw new RockyError(
        "candidate_stale",
        "Candidate revision or hash changed",
        409,
      );
    return candidate;
  }
  edit(id: string, input: unknown) {
    const command = candidateEditSchema.parse(input),
      intent = intentHash({ id, ...command });
    return this.store.transaction(() => {
      const replay = this.receipt(command.requestId, intent);
      if (replay) return replay;
      const old = this.target(
          id,
          command.expectedRevision,
          command.candidateHash,
        ),
        episode = this.source(old);
      if (
        ["evaluating", "published", "withdrawn", "quarantined"].includes(
          old.status,
        ) ||
        old.candidateRevision >= 3
      )
        throw new RockyError(
          "candidate_state",
          "Stop evaluation before editing; published/withdrawn candidates or the two-revision budget cannot be changed",
          409,
        );
      const evidence = z
        .array(z.object({ id: z.uuid() }))
        .parse(episode.evidence);
      if (
        command.draft.evidenceRefs.some(
          (id) => !evidence.some((item) => item.id === id),
        )
      )
        throw new RockyError(
          "candidate_evidence",
          "Evidence is outside the approved episode",
          403,
        );
      const materialized = this.materialize(
        command.draft,
        old.base,
        command.reason,
      );
      const candidate = candidateSchema.parse({
        ...old,
        ...command.draft,
        ...materialized,
        candidateRevision: old.candidateRevision + 1,
        revision: old.revision + 1,
        candidateHash: intentHash({
          draft: command.draft,
          base: old.base,
          scope: old.scope,
          packageHash: materialized.packageHash,
        }),
        status: "draft",
        evaluationId: null,
        reason: command.reason,
        updatedAt: new Date().toISOString(),
      });
      this.store.db
        .prepare(
          "UPDATE learning_evaluations SET invalidated=1 WHERE candidate_id=?",
        )
        .run(id);
      return this.record(
        command.requestId,
        intent,
        this.save(candidate, "edited_evaluations_invalidated"),
      );
    });
  }
  transition(
    id: string,
    status: SkillCandidate["status"],
    evaluationId: string | null,
    reason: string | null,
    expectedHash: string,
  ) {
    const perform = () => {
      const candidate = this.get(id);
      if (
        candidate.candidateHash !== expectedHash ||
        ["withdrawn", "rejected", "quarantined", "published"].includes(
          candidate.status,
        )
      )
        throw new RockyError(
          "candidate_stale",
          "Evaluation no longer owns this candidate",
          409,
        );
      this.source(candidate);
      candidate.status = status;
      candidate.evaluationId = evaluationId;
      candidate.reason = reason;
      candidate.revision++;
      candidate.updatedAt = new Date().toISOString();
      return this.save(candidate, status);
    };
    return this.store.db.isTransaction
      ? perform()
      : this.store.transaction(perform);
  }
  command(id: string, input: unknown) {
    const command = candidateCommandSchema.parse(input),
      intent = intentHash({ id, ...command });
    return this.store.transaction(() => {
      const replay = this.receipt(command.requestId, intent);
      if (replay) return replay;
      const candidate = this.target(
        id,
        command.expectedRevision,
        command.candidateHash,
      );
      if (candidate.status === "evaluating")
        throw new RockyError(
          "candidate_busy",
          "Stop the evaluation before changing its candidate",
          409,
        );
      if (command.action === "approve") {
        this.source(candidate);
        if (
          candidate.status !== "needs_review" ||
          !command.evaluationId ||
          candidate.evaluationId !== command.evaluationId
        )
          throw new RockyError(
            "candidate_gate",
            "Approve the exact current evaluation and candidate",
            409,
          );
        const row = this.store.db
          .prepare(
            "SELECT data,invalidated FROM learning_evaluations WHERE id=? AND candidate_id=?",
          )
          .get(command.evaluationId, id) as
          { data: string; invalidated: number } | undefined;
        const evaluation = row ? JSON.parse(row.data) : null;
        if (
          command.baseRevision !== (candidate.base?.revision ?? null) ||
          command.policyRevision !== this.learning.policy().revision ||
          !evaluation ||
          command.evaluationManifestHash !== intentHash(evaluation.manifest)
        )
          throw new RockyError(
            "candidate_gate",
            "Publication base, manifest or policy changed; review again",
            409,
          );
        if (
          !row ||
          row.invalidated ||
          evaluation.status !== "completed" ||
          evaluation.verdict !== "passed" ||
          evaluation.candidateHash !== candidate.candidateHash ||
          evaluation.candidateRevision !== candidate.candidateRevision
        )
          throw new RockyError(
            "candidate_gate",
            "Evaluation does not pass the exact candidate publication gate",
            409,
          );
        const snapshot = this.package(candidate);
        candidate.status = "published";
        candidate.revision++;
        candidate.updatedAt = new Date().toISOString();
        candidate.reason = "owner_approved_exact_evaluation";
        this.save(candidate, "approved");
        candidate.published = this.skills.publishCandidate(
          candidate,
          command.requestId,
          {
            directoryName: candidate.name,
            files: snapshot.files.map(({ path, contentBase64 }) => ({
              path,
              contentBase64,
            })),
          },
        );
        return this.record(
          command.requestId,
          intent,
          this.save(candidate, "published"),
        );
      }
      if (["published", "quarantined", "withdrawn"].includes(candidate.status))
        throw new RockyError(
          "candidate_state",
          "Candidate is terminal; use the Skill Registry for published revision controls",
          409,
        );
      if (command.action === "resubmit") {
        this.source(candidate);
        candidate.status = "draft";
        candidate.evaluationId = null;
      } else {
        candidate.status =
          command.action === "reject"
            ? "rejected"
            : command.action === "withdraw"
              ? "withdrawn"
              : "quarantined";
        this.store.db
          .prepare(
            "UPDATE learning_evaluations SET invalidated=1 WHERE candidate_id=?",
          )
          .run(id);
      }
      candidate.reason = `owner_${command.action}`;
      candidate.revision++;
      candidate.updatedAt = new Date().toISOString();
      return this.record(
        command.requestId,
        intent,
        this.save(candidate, command.action),
      );
    });
  }
}
