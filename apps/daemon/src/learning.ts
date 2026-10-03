import {
  learningPolicySchema,
  learningPolicyCommandSchema,
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
