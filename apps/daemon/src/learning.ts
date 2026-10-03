import {
  learningPolicySchema,
  learningPolicyCommandSchema,
  learningWorkConsentSchema,
  learningWorkConsentCommandSchema,
} from "../../../packages/contracts/src/learning.js";
import { RockyError } from "../../../packages/contracts/src/index.js";
import { intentHash } from "./intent.js";
import type { Store } from "./store.js";
import type { WorkspaceRegistry } from "./workspaces.js";
export class LearningRegistry {
  constructor(
    private readonly store: Store,
    private readonly workspaces: WorkspaceRegistry,
  ) {}
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
