import { z } from "zod";
import { randomUUID } from "node:crypto";
import {
  reflectionBindingSchema,
  reflectionToolSchemas,
} from "../../../packages/contracts/src/reflection.js";
import {
  RockyError,
  type Work,
} from "../../../packages/contracts/src/index.js";
import type { Store } from "./store.js";
import type { LearningRegistry } from "./learning.js";
import type { SkillRegistry } from "./skills.js";
import { intentHash } from "./intent.js";
export class ReflectionRegistry {
  constructor(
    private readonly store: Store,
    private readonly learning: LearningRegistry,
    private readonly skills: SkillRegistry,
  ) {}
  check(input: unknown) {
    const binding = reflectionBindingSchema.parse(input);
    const episode = this.learning.episode(binding.episodeId);
    if (
      episode.status !== "approved" ||
      episode.revision !== binding.episodeRevision ||
      episode.contentHash !== binding.episodeHash ||
      episode.reviewedHash !== episode.contentHash
    )
      throw new RockyError(
        "reflection_source",
        "Reflection requires the exact approved current episode view",
        403,
      );
    return { binding, episode };
  }
  results(workId: string, before?: string) {
    const work = this.store.get(workId);
    if (work.runMode !== "reflection" || !work.reflection)
      throw new RockyError(
        "reflection_work",
        "Results require a reflection Work",
        422,
      );
    this.check(work.reflection);
    if (
      before !== undefined &&
      (!/^[1-9][0-9]{0,18}$/.test(before) ||
        BigInt(before) > 9223372036854775807n)
    )
      throw new RockyError(
        "reflection_cursor",
        "Invalid reflection result cursor",
        422,
      );
    const rows = this.store.db
      .prepare(
        "SELECT CAST(rowid AS TEXT) AS cursor,data FROM learning_reflection_outputs WHERE json_extract(data,'$.execution.workId')=? AND json_extract(data,'$.execution.runId')=? AND json_extract(data,'$.execution.executionSessionId')=? AND rowid<CAST(? AS INTEGER) ORDER BY rowid DESC LIMIT 21",
      )
      .all(
        work.id,
        work.runId,
        work.executionSessionId,
        before ?? "9223372036854775807",
      ) as { cursor: string; data: string }[];
    const page = rows.slice(0, 20);
    return this.store.publicEvidence({
      workId: work.id,
      runId: work.runId,
      status: work.status,
      revision: work.revision,
      outputs: page.map((row) => JSON.parse(row.data)),
      nextCursor: rows.length > 20 ? page.at(-1)!.cursor : null,
    });
  }
  checkWork(owner: Work) {
    const current = this.store.get(owner.id);
    if (
      current.runMode !== "reflection" ||
      current.mode !== "configured" ||
      current.status !== "running" ||
      current.runId !== owner.runId ||
      current.executionSessionId !== owner.executionSessionId ||
      !current.reflection
    )
      throw new RockyError(
        "reflection_owner",
        "Reflection requires a running owned execution",
        403,
      );
    return this.check(current.reflection);
  }
  dispatch(
    owner: Work,
    name: string,
    args: Record<string, unknown>,
    callId?: string,
  ) {
    // Synchronous validation and call share one event-loop turn; call owns the transaction.
    const { binding } = this.checkWork(owner);
    if (
      intentHash(binding) !==
      intentHash(reflectionBindingSchema.parse(args.binding))
    )
      throw new RockyError(
        "reflection_owner",
        "Reflection request changed the stored episode binding",
        403,
      );
    if (name === "rocky_reflection_check") return "ok";
    if (name !== "rocky_reflection_tool" || !callId)
      throw new RockyError(
        "reflection_tool",
        "Reflection RPC is not allowed",
        403,
      );
    return JSON.stringify(
      this.call(binding, callId, z.string().parse(args.name), args.args, {
        workId: owner.id,
        runId: owner.runId,
        executionSessionId: owner.executionSessionId,
      }),
    );
  }
  private allowed(workId: string) {
    return (this.skills.catalog(workId)?.items ?? []).filter(
      (item) =>
        !this.store.db
          .prepare("SELECT 1 FROM skill_quarantine WHERE id=? AND hash=?")
          .get(item.id, item.contentHash),
    );
  }
  call(
    input: unknown,
    callId: string,
    name: string,
    args: unknown,
    execution?: { workId: string; runId: string; executionSessionId: string },
  ) {
    z.string().min(1).max(300).parse(callId);
    if (!Object.hasOwn(reflectionToolSchemas, name))
      throw new RockyError(
        "reflection_tool",
        "Reflection tool is not allowed",
        403,
      );
    const parsed =
      reflectionToolSchemas[name as keyof typeof reflectionToolSchemas].parse(
        args,
      );
    if (Buffer.byteLength(JSON.stringify(parsed)) > 65536)
      throw new RockyError(
        "reflection_size",
        "Reflection payload exceeds limit",
        422,
      );
    return this.store.transaction(() => {
      const { binding, episode } = this.check(input);
      if (name === "read_learning_episode") return episode;
      const allowed = this.allowed(episode.workId);
      if (name === "list_allowed_skills")
        return this.store.publicEvidence({ skills: allowed });
      const permitted = (ref: {
        skillId: string;
        revision: number;
        contentHash: string;
      }) => {
        if (
          !allowed.some(
            (item) =>
              item.id === ref.skillId &&
              item.revision === ref.revision &&
              item.contentHash === ref.contentHash,
          )
        )
          throw new RockyError(
            "reflection_skill",
            "Skill revision is outside this episode's frozen source catalog",
            403,
          );
        return this.skills.get(ref.skillId, ref.revision);
      };
      if (name === "read_skill_revision") {
        const ref = reflectionToolSchemas.read_skill_revision.parse(parsed),
          snapshot = permitted(ref),
          file = snapshot.package.files.find(
            (file) => file.path === "SKILL.md",
          )!;
        const text = Buffer.from(file.contentBase64, "base64").toString("utf8");
        if (Buffer.byteLength(text) > 65536)
          throw new RockyError(
            "reflection_size",
            "Skill text exceeds reflection read limit",
            422,
          );
        return this.store.publicEvidence({
          revision: snapshot.revision,
          content: text,
        });
      }
      if (name === "propose_skill_patch")
        permitted(reflectionToolSchemas.propose_skill_patch.parse(parsed).base);
      const refs =
        name === "propose_skill_create"
          ? reflectionToolSchemas.propose_skill_create.parse(parsed).candidate
              .evidenceRefs
          : name === "propose_skill_patch"
            ? reflectionToolSchemas.propose_skill_patch.parse(parsed).changes
                .evidenceRefs
            : undefined;
      const evidence = z
        .array(z.object({ id: z.uuid() }))
        .parse(episode.evidence);
      if (refs?.some((id) => !evidence.some((event) => event.id === id)))
        throw new RockyError(
          "reflection_evidence",
          "Candidate references evidence outside the approved episode",
          403,
        );
      if (
        JSON.stringify(this.store.publicEvidence(parsed)) !==
        JSON.stringify(parsed)
      )
        throw new RockyError(
          "reflection_secret",
          "Reflection output contains protected content",
          403,
        );
      const key = intentHash({
          binding,
          callId,
          ...(execution ? { execution } : {}),
        }),
        hash = intentHash({ binding, name, args: parsed });
      const prior = this.store.db
        .prepare(
          "SELECT intent,data FROM learning_reflection_outputs WHERE call_key=?",
        )
        .get(key) as { intent: string; data: string } | undefined;
      if (prior) {
        if (prior.intent !== hash)
          throw new RockyError(
            "idempotency_conflict",
            "Reflection tool call changed",
            409,
          );
        return JSON.parse(prior.data);
      }
      const result = {
        id: randomUUID(),
        episodeId: binding.episodeId,
        sourceWorkId: episode.workId,
        ...(execution ? { execution } : {}),
        binding,
        kind: name,
        status: name === "mark_no_learning" ? "no_learning" : "proposed",
        scope: episode.scope,
        payload: parsed,
        contentHash: hash,
        createdAt: new Date().toISOString(),
      };
      this.store.db
        .prepare("INSERT INTO learning_reflection_outputs VALUES(?,?,?,?)")
        .run(result.id, key, hash, JSON.stringify(result));
      return result;
    });
  }
}
