import { z } from "zod";
import { createHash } from "node:crypto";
import { evaluationSuiteCommandSchema } from "../../../packages/contracts/src/learning-evaluation.js";
import { RockyError } from "../../../packages/contracts/src/index.js";
import type { Store } from "./store.js";
import { intentHash } from "./intent.js";
const suiteSchema = evaluationSuiteCommandSchema
  .omit({ requestId: true, expectedRevision: true })
  .extend({
    revision: z.number().int().positive(),
    hash: z.string(),
    createdAt: z.iso.datetime(),
  });
const suiteHash = (value: unknown) =>
  createHash("sha256")
    .update("rocky.evaluation-suite.v1\n")
    .update(JSON.stringify(value))
    .digest("hex");
export type EvaluationSuite = z.infer<typeof suiteSchema>;
export class EvaluationSuites {
  constructor(private readonly store: Store) {}
  get(id: string, revision: number) {
    const row = this.store.db
      .prepare("SELECT data FROM evaluation_suites WHERE id=? AND revision=?")
      .get(z.uuid().parse(id), z.number().int().positive().parse(revision)) as
      { data: string } | undefined;
    if (!row)
      throw new RockyError(
        "suite_missing",
        "Evaluation suite revision not found",
        404,
      );
    const suite = suiteSchema.parse(JSON.parse(row.data)),
      { hash, createdAt: _createdAt, ...content } = suite;
    void _createdAt;
    if (suiteHash(content) !== hash)
      throw new RockyError(
        "suite_integrity",
        "Evaluation suite hash changed",
        409,
      );
    return suite;
  }
  list() {
    return (
      this.store.db
        .prepare(
          "SELECT id,max(revision) AS revision FROM evaluation_suites GROUP BY id ORDER BY id LIMIT 200",
        )
        .all() as { id: string; revision: number }[]
    ).map((row) => {
      const suite = this.get(row.id, row.revision);
      return {
        id: suite.id,
        revision: suite.revision,
        hash: suite.hash,
        name: suite.name,
        cases: suite.cases.length,
        primaryMetric: suite.primaryMetric,
        improvement: suite.improvement,
        createdAt: suite.createdAt,
      };
    });
  }
  save(input: unknown) {
    const command = evaluationSuiteCommandSchema.parse(input),
      intent = suiteHash(command);
    if (
      Buffer.byteLength(JSON.stringify(command)) > 1048576 ||
      JSON.stringify(this.store.publicEvidence(command)) !==
        JSON.stringify(command)
    )
      throw new RockyError(
        "suite_content",
        "Suite exceeds bounds or contains protected content",
        422,
      );
    if (
      new Set(command.cases.map((item) => item.id)).size !==
      command.cases.length
    )
      throw new RockyError(
        "suite_cases",
        "Case identities must be unique",
        422,
      );
    const groups = new Map<string, string>();
    for (const item of command.cases)
      for (const key of [
        `family:${item.family}`,
        `source:${item.sourceGroup}`,
        `prompt:${intentHash(item.prompt)}`,
      ]) {
        if (groups.has(key) && groups.get(key) !== item.split)
          throw new RockyError(
            "suite_leakage",
            "Task family, source group or identical prompt crosses evaluation splits",
            422,
          );
        groups.set(key, item.split);
      }
    return this.store.transaction(() => {
      const receipt = this.store.db
        .prepare(
          "SELECT intent,data FROM evaluation_suite_receipts WHERE request_id=?",
        )
        .get(command.requestId) as { intent: string; data: string } | undefined;
      if (receipt) {
        if (receipt.intent !== intent)
          throw new RockyError(
            "idempotency_conflict",
            "Suite request changed",
            409,
          );
        return suiteSchema.parse(JSON.parse(receipt.data));
      }
      const row = this.store.db
        .prepare(
          "SELECT max(revision) AS revision FROM evaluation_suites WHERE id=?",
        )
        .get(command.id) as { revision: number | null };
      if ((row.revision ?? 0) !== command.expectedRevision)
        throw new RockyError("suite_stale", "Suite revision changed", 409);
      const { requestId, expectedRevision, ...values } = command,
        content = { ...values, revision: expectedRevision + 1 };
      const suite = suiteSchema.parse({
        ...content,
        hash: suiteHash(content),
        createdAt: new Date().toISOString(),
      });
      this.store.db
        .prepare("INSERT INTO evaluation_suites VALUES(?,?,?)")
        .run(suite.id, suite.revision, JSON.stringify(suite));
      this.store.db
        .prepare("INSERT INTO evaluation_suite_receipts VALUES(?,?,?)")
        .run(requestId, intent, JSON.stringify(suite));
      return suite;
    });
  }
  adequacy(suite: EvaluationSuite) {
    const independent =
      new Set(suite.cases.map((item) => intentHash(item.prompt))).size ===
        suite.cases.length &&
      new Set(
        suite.cases.map((item) => intentHash([item.family, item.sourceGroup])),
      ).size === suite.cases.length;
    const counts = Object.fromEntries(
      ["train", "validation", "holdout"].map((split) => [
        split,
        suite.cases.filter((item) => item.split === split).length,
      ]),
    );
    return {
      sufficient:
        independent &&
        counts.train! >= 6 &&
        counts.validation! >= 3 &&
        counts.holdout! >= 3 &&
        suite.cases.some((item) => item.negative),
      independent,
      counts,
      negative: suite.cases.some((item) => item.negative),
    };
  }
}
