import { z } from "zod";
import { randomUUID } from "node:crypto";
import {
  reflectionBindingSchema,
  reflectionToolSchemas,
} from "../../../packages/contracts/src/reflection.js";
import { RockyError } from "../../../packages/contracts/src/index.js";
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
  private allowed(workId: string) {
    return (this.skills.catalog(workId)?.items ?? []).filter(
      (item) =>
        !this.store.db
          .prepare("SELECT 1 FROM skill_quarantine WHERE id=? AND hash=?")
          .get(item.id, item.contentHash),
    );
  }
  call(input: unknown, callId: string, name: string, args: unknown) {
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
      const key = intentHash({ binding, callId }),
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
