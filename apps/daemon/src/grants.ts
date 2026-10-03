import { randomUUID } from "node:crypto";
import { Store } from "./store.js";
import { intentHash } from "./intent.js";
import {
  RockyError,
  type Work,
} from "../../../packages/contracts/src/index.js";
import {
  issueSchema,
  grantSchema,
  revokeGrantSchema,
} from "../../../packages/contracts/src/grants.js";
export class GrantRegistry {
  constructor(
    private readonly store: Store,
    private readonly now = () => Date.now(),
  ) {}
  issue(input: unknown) {
    const command = issueSchema.parse(input),
      hash = intentHash(command);
    const prior = this.store.db
      .prepare("SELECT intent,data FROM capability_grants WHERE request_id=?")
      .get(command.requestId) as { intent: string; data: string } | undefined;
    if (prior) {
      if (prior.intent !== hash)
        throw new RockyError("grant_conflict", "Grant request changed", 409);
      return grantSchema.parse(JSON.parse(prior.data));
    }
    const work = this.store.get(command.workId);
    if (!["queued", "running", "waiting_approval"].includes(work.status))
      throw new RockyError(
        "grant_inactive",
        "Cannot grant a terminal Work",
        409,
      );
    if (command.expiresAt && Date.parse(command.expiresAt) <= this.now())
      throw new RockyError("grant_expired", "Grant already expired", 409);
    const grant = grantSchema.parse({
      ...command,
      id: randomUUID(),
      runId: work.runId,
      executionSessionId: work.executionSessionId,
      revision: 1,
      revoked: false,
    });
    this.store.transaction(() => {
      this.store.db
        .prepare("INSERT INTO capability_grants VALUES(?,?,?,?)")
        .run(grant.id, command.requestId, hash, JSON.stringify(grant));
      this.store.event(work, "rocky.grant.issued", { grant });
    });
    return grant;
  }
  list(workId: string) {
    return (
      this.store.db
        .prepare(
          "SELECT data FROM capability_grants WHERE json_extract(data,'$.workId')=?",
        )
        .all(workId) as { data: string }[]
    ).map((row) => grantSchema.parse(JSON.parse(row.data)));
  }
  allows(
    work: Work,
    targetHash: string,
    effect: "known_read" | "local_new",
    policyRevision: number,
  ) {
    const owned = this.store.get(work.id);
    if (
      owned.runId !== work.runId ||
      owned.executionSessionId !== work.executionSessionId ||
      owned.status !== "running"
    )
      return false;
    return this.list(owned.id).some(
      (g) =>
        !g.revoked &&
        g.runId === owned.runId &&
        g.executionSessionId === owned.executionSessionId &&
        g.targetHash === targetHash &&
        g.effect === effect &&
        g.policyRevision === policyRevision &&
        (!g.expiresAt || Date.parse(g.expiresAt) > this.now()),
    );
  }
  revoke(workId: string, id: string, input: unknown) {
    const command = revokeGrantSchema.parse(input),
      { expectedRevision } = command;
    const intent = intentHash({ workId, id, ...command });
    const prior = this.store.db
      .prepare("SELECT intent,data FROM grant_receipts WHERE request_id=?")
      .get(command.requestId) as { intent: string; data: string } | undefined;
    if (prior) {
      if (prior.intent !== intent)
        throw new RockyError(
          "grant_conflict",
          "Revocation request changed",
          409,
        );
      return grantSchema.parse(JSON.parse(prior.data));
    }
    const grant = this.list(workId).find((g) => g.id === id);
    if (!grant || grant.revision !== expectedRevision)
      throw new RockyError("grant_conflict", "Grant revision changed", 409);

    const next = {
      ...grant,
      revision: grant.revoked ? grant.revision : grant.revision + 1,
      revoked: true,
    };
    this.store.transaction(() => {
      const changed = this.store.db
        .prepare(
          "UPDATE capability_grants SET data=? WHERE id=? AND json_extract(data,'$.revision')=?",
        )
        .run(JSON.stringify(next), id, expectedRevision);
      if (changed.changes !== 1)
        throw new RockyError("grant_conflict", "Grant revision changed", 409);
      this.store.db
        .prepare("INSERT INTO grant_receipts VALUES(?,?,?)")
        .run(command.requestId, intent, JSON.stringify(next));
      if (!grant.revoked)
        this.store.event(this.store.get(workId), "rocky.grant.revoked", {
          grant: next,
        });
    });
    return next;
  }
}
