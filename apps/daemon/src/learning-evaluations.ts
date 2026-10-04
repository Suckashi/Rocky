import { randomUUID } from "node:crypto";
import { fork } from "node:child_process";
import { mkdir, lstat } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { evaluationStartSchema } from "../../../packages/contracts/src/learning-evaluation.js";
import { RockyError } from "../../../packages/contracts/src/index.js";
import type { Work } from "../../../packages/contracts/src/index.js";
import { RockyEvaluationProvider } from "../../../packages/agent-runtime/src/evaluation-provider.js";
import type { WorkService } from "./work-service.js";
import { EvaluationSuites, type EvaluationSuite } from "./evaluation-suites.js";
import { intentHash } from "./intent.js";
import { assertAutomaticAuthorization } from "./learning-automation.js";
import { LearningQuota } from "./learning-quota.js";
import { evaluationCaseSchema } from "../../../packages/contracts/src/learning-evaluation.js";
import { readFileSync, existsSync } from "node:fs";
type Target = z.infer<typeof evaluationStartSchema>["target"];
type CaseResult = Awaited<
  ReturnType<RockyEvaluationProvider["callLearningCase"]>
>;
type Result = {
  caseId: string;
  caseHash: string;
  repetition: number;
  split: "train" | "validation" | "holdout";
  variant: "baseline" | "current" | "candidate";
  result: CaseResult;
};
export type LearningEvaluation = {
  id: string;
  proposalId: string;
  candidateHash: string;
  candidateRevision: number;
  suiteId: string;
  suiteRevision: number;
  suiteHash: string;
  target: Target;
  current: { skillId: string; revision: number; contentHash: string } | null;
  status:
    "queued" | "running" | "completed" | "failed" | "stopped" | "interrupted";
  verdict: "pending" | "passed" | "failed" | "insufficient_evidence";
  reason: string | null;
  results: Result[];
  calls: number;
  tokens: number;
  unknownUsage: boolean;
  manifest: Record<string, unknown>;
  promptfoo: unknown[];
  createdAt: string;
  endedAt: string | null;
};
export class LearningEvaluations {
  readonly suites: EvaluationSuites;
  readonly quota: LearningQuota;
  private active = new Map<
    string,
    { abort: AbortController; promise: Promise<void> }
  >();
  private closing = false;
  constructor(private readonly service: WorkService) {
    this.suites = new EvaluationSuites(service.store);
    this.quota = new LearningQuota(service.store);
    for (const row of service.store.db
      .prepare(
        "SELECT data FROM learning_evaluations WHERE json_extract(data,'$.status') IN ('queued','running')",
      )
      .all() as { data: string }[]) {
      const value = JSON.parse(row.data) as LearningEvaluation;
      value.status = "interrupted";
      value.verdict = "insufficient_evidence";
      value.reason = "Daemon restarted; no evaluation call was replayed";
      value.endedAt = new Date().toISOString();
      this.save(value);
      try {
        service.candidates.transition(
          value.proposalId,
          "failed",
          value.id,
          value.reason,
          value.candidateHash,
        );
      } catch {
        /* A withdrawn source remains fenced. */
      }
    }
  }
  get(id: string): LearningEvaluation {
    const row = this.service.store.db
      .prepare("SELECT data FROM learning_evaluations WHERE id=?")
      .get(z.uuid().parse(id)) as { data: string } | undefined;
    if (!row)
      throw new RockyError("evaluation_missing", "Evaluation not found", 404);
    return JSON.parse(row.data) as LearningEvaluation;
  }
  view(id: string) {
    const value = this.get(id);
    this.service.candidates.source(
      this.service.candidates.get(value.proposalId),
    );
    return { ...value, manifestHash: intentHash(value.manifest) };
  }
  private save(value: LearningEvaluation) {
    const prior = this.service.store.db
      .prepare("SELECT invalidated FROM learning_evaluations WHERE id=?")
      .get(value.id) as { invalidated: number } | undefined;
    if (prior?.invalidated) {
      value.results = [];
      value.verdict = "insufficient_evidence";
      value.reason =
        "Source or candidate invalidated; derived report details removed";
    }
    this.service.store.db
      .prepare(
        "INSERT INTO learning_evaluations(id,candidate_id,data,invalidated) VALUES(?,?,?,0) ON CONFLICT(id) DO UPDATE SET data=excluded.data",
      )
      .run(value.id, value.proposalId, JSON.stringify(value));
  }
  start(id: string, input: unknown) {
    const command = evaluationStartSchema.parse(input),
      intent = intentHash({ id, ...command }),
      store = this.service.store;
    const receipt = store.db
      .prepare(
        "SELECT intent,evaluation_id FROM evaluation_receipts WHERE request_id=?",
      )
      .get(command.requestId) as
      { intent: string; evaluation_id: string } | undefined;
    if (receipt) {
      if (receipt.intent !== intent)
        throw new RockyError(
          "idempotency_conflict",
          "Evaluation request changed",
          409,
        );
      return this.view(receipt.evaluation_id);
    }
    if (this.closing || this.active.size)
      throw new RockyError(
        "evaluation_busy",
        "Only one Learning evaluation can run at a time",
        409,
      );
    const candidate = this.service.candidates.get(id);
    this.service.candidates.source(candidate);
    if (
      candidate.revision !== command.expectedRevision ||
      candidate.candidateHash !== command.candidateHash ||
      !["draft", "failed", "insufficient_evidence", "needs_review"].includes(
        candidate.status,
      )
    )
      throw new RockyError(
        "candidate_stale",
        "Candidate is not available for this evaluation",
        409,
      );
    const suite = this.suites.get(command.suiteId, command.suiteRevision);
    if (suite.hash !== command.suiteHash)
      throw new RockyError("suite_stale", "Suite hash changed", 409);
    const config =
      command.target.mode === "configured"
        ? this.service.models.assertRunnable(
            command.target.modelSelection.connectionId,
            command.target.modelSelection.revision,
          ).config
        : null;
    const selected = candidate.base
      ? this.service.skills.selection(candidate.base.skillId)
      : null;
    const current =
      selected?.state === "published"
        ? {
            skillId: selected.id,
            revision: selected.skillRevision,
            contentHash: selected.contentHash,
          }
        : null;
    const value: LearningEvaluation = {
      id: randomUUID(),
      proposalId: id,
      candidateHash: candidate.candidateHash,
      candidateRevision: candidate.candidateRevision,
      suiteId: suite.id,
      suiteRevision: suite.revision,
      suiteHash: suite.hash,
      target: command.target,
      current,
      status: "queued",
      verdict: "pending",
      reason: null,
      results: [],
      calls: 0,
      tokens: 0,
      unknownUsage: false,
      promptfoo: [],
      createdAt: new Date().toISOString(),
      endedAt: null,
      manifest: {
        version: 1,
        productId: "rocky",
        node: process.version,
        platform: process.platform,
        arch: process.arch,
        target: command.target,
        modelConfigHash: config ? intentHash(config) : null,
        providerEndpoint: config?.baseUrl ?? "local-fixture",
        modelId: config?.modelId ?? "synthetic",
        generator: "not_used_during_evaluation",
        grader: "application_owned_deterministic_assertions",
        seed: "provider_not_configured",
        tools: [
          "inspect_sample",
          "write_sample",
          "native_task",
          "private_scratch",
          "read_only_frozen_skills",
        ],
        policy: "isolated_data_only_fixture_v1",
        executor: "node_fixture_not_os_sandbox",
        suiteHash: suite.hash,
        caseVersions: suite.cases.map((item) => ({
          id: item.id,
          revision: item.revision,
          hash: intentHash(item),
          split: item.split,
          family: item.family,
          sourceGroup: item.sourceGroup,
        })),
        modelBudget: suite.modelBudget,
        tokenAccounting:
          command.target.mode === "fixture"
            ? "not_applicable_deterministic_fixture_no_tokenizer; calls, wall and storage limits still enforced; never eligible for publication"
            : "actual_provider_usage_required_with_conservative_reservations",
        budgets: {
          maxRuns: suite.maxRuns,
          maxModelCalls: suite.maxModelCalls,
          maxTokens: suite.maxTokens,
          wallBudgetMs: suite.wallBudgetMs,
          reportByteBudget: suite.reportByteBudget,
        },
        primaryMetric: suite.primaryMetric,
        improvement: suite.improvement,
        minimumImprovement: suite.minimumImprovement,
        candidatePackageHash: candidate.packageHash,
        baseline: null,
        current,
        finalHoldoutExposed: false,
        adequacy: this.suites.adequacy(suite),
      },
    };
    const sourcePackage = new URL("../../../package.json", import.meta.url);
    const dependencies = JSON.parse(
      readFileSync(
        existsSync(sourcePackage)
          ? sourcePackage
          : new URL("../../../../package.json", import.meta.url),
        "utf8",
      ),
    ).dependencies;
    value.manifest.runtimeDependencies = Object.fromEntries(
      [
        "deepagents",
        "@langchain/core",
        "@langchain/langgraph",
        "@modelcontextprotocol/sdk",
        "promptfoo",
      ].map((name) => [name, dependencies[name] ?? "unavailable"]),
    );
    value.manifest.caseSchemaHash = intentHash(
      JSON.parse(JSON.stringify(z.toJSONSchema(evaluationCaseSchema))),
    );
    value.manifest.fixtureToolSchemas = {
      inspect_sample: {
        type: "object",
        properties: { label: { type: "string" } },
        required: ["label"],
      },
      write_sample: {
        type: "object",
        properties: { value: { type: "string" } },
        required: ["value"],
      },
    };
    value.manifest.cacheQuotaBytes = this.quota.limit;
    value.manifest.repetitions = suite.cases.map((item) => ({
      caseId: item.id,
      samplesPerVariant:
        command.target.mode === "configured" ? item.repetitions : 1,
    }));
    store.transaction(() => {
      this.save(value);
      store.db
        .prepare("INSERT INTO evaluation_receipts VALUES(?,?,?)")
        .run(command.requestId, intent, value.id);
      this.service.candidates.transition(
        id,
        "evaluating",
        value.id,
        null,
        value.candidateHash,
      );
    });
    const abort = new AbortController();
    const promise = Promise.resolve()
      .then(() => this.run(value, suite, abort.signal))
      .finally(() => this.active.delete(value.id));
    this.active.set(value.id, { abort, promise });
    return value;
  }
  private check(value: LearningEvaluation) {
    assertAutomaticAuthorization(this.service.store, {
      evaluationId: value.id,
    });
    const candidate = this.service.candidates.get(value.proposalId);
    this.service.candidates.source(candidate);
    const row = this.service.store.db
      .prepare("SELECT invalidated FROM learning_evaluations WHERE id=?")
      .get(value.id) as { invalidated: number };
    if (
      row.invalidated ||
      candidate.candidateHash !== value.candidateHash ||
      candidate.status !== "evaluating" ||
      candidate.evaluationId !== value.id
    )
      throw new RockyError(
        "evaluation_stale",
        "Candidate, source or evaluation ownership changed",
        409,
      );
  }
  assertWork(work: Work) {
    if (work.evaluation) this.check(this.get(work.evaluation.evaluationId));
  }
  private metric(
    value: LearningEvaluation,
    split: Result["split"],
    variant: Result["variant"],
    field: "passed" | "calls" | "tokens",
  ) {
    const results = value.results.filter(
      (item) => item.split === split && item.variant === variant,
    );
    return results.length
      ? results.reduce((sum, item) => sum + Number(item.result[field]), 0) /
          results.length
      : null;
  }
  private comparison(
    value: LearningEvaluation,
    suite: EvaluationSuite,
    split: Result["split"],
    improvement: boolean,
  ) {
    const comparisons: Result["variant"][] = value.current
      ? ["baseline", "current"]
      : ["baseline"];
    const candidate = this.metric(value, split, "candidate", "passed");
    if (candidate === null) return false;
    const required = suite.cases.filter(
      (item) => item.split === split && item.required,
    );
    if (
      !required.every((item) => {
        const samples = value.results.filter(
          (row) => row.caseId === item.id && row.variant === "candidate",
        );
        return (
          samples.length ===
            (value.target.mode === "configured" ? item.repetitions : 1) &&
          samples.every((row) => row.result.passed)
        );
      })
    )
      return false;
    for (const variant of comparisons) {
      const score = this.metric(value, split, variant, "passed");
      if (score === null || candidate < score) return false;
      for (const item of suite.cases.filter((entry) => entry.split === split)) {
        const average = (name: Result["variant"]) => {
          const rows = value.results.filter(
            (row) => row.caseId === item.id && row.variant === name,
          );
          return rows.length
            ? rows.filter((row) => row.result.passed).length / rows.length
            : -1;
        };
        if (average("candidate") < average(variant)) return false;
      }
    }
    if (!improvement) return true;
    const field =
      suite.improvement === "task_success"
        ? "passed"
        : suite.improvement === "model_calls"
          ? "calls"
          : "tokens";
    const metric = this.metric(value, split, "candidate", field)!;
    return comparisons.every((variant) => {
      const comparison = this.metric(value, split, variant, field)!;
      return field === "passed"
        ? metric - comparison >= suite.minimumImprovement
        : comparison - metric >= suite.minimumImprovement;
    });
  }
  private async stage(
    value: LearningEvaluation,
    suite: EvaluationSuite,
    splits: Result["split"][],
    signal: AbortSignal,
  ) {
    await this.quota.check(Buffer.byteLength(JSON.stringify(value)), value.id);
    const root = join(this.service.store.root, "learning-evaluations");
    await mkdir(root, { recursive: true });
    if ((await lstat(root)).isSymbolicLink())
      throw new RockyError(
        "evaluation_path",
        "Evaluation storage is linked",
        409,
      );
    const directory = join(root, value.id);
    await mkdir(directory, { recursive: true });
    if ((await lstat(directory)).isSymbolicLink())
      throw new RockyError(
        "evaluation_path",
        "Evaluation report directory is linked",
        409,
      );
    const plan = suite.cases.flatMap((item, index) =>
      splits.includes(item.split)
        ? Array.from(
            {
              length: value.target.mode === "configured" ? item.repetitions : 1,
            },
            (_, repetition) =>
              (value.current
                ? (["baseline", "current", "candidate"] as const)
                : (["baseline", "candidate"] as const)
              ).map((variant) => ({ index, variant, repetition })),
          ).flat()
        : [],
    );
    if (!plan.length) return;
    const stageAbort = new AbortController();
    signal = AbortSignal.any([signal, stageAbort.signal]);
    await new Promise<void>((resolve, reject) => {
      const child = fork(
        new URL("./promptfoo-worker.mjs", import.meta.url),
        [],
        {
          execPath: process.execPath,
          execArgv: [
            "--import",
            new URL(
              "../../../scripts/worker-network-guard.mjs",
              import.meta.url,
            ).href,
          ],
          env: {
            ...Object.fromEntries(
              ["PATH", "SystemRoot", "TEMP", "TMP"].flatMap((key) =>
                process.env[key] ? [[key, process.env[key]!]] : [],
              ),
            ),
            HOME: directory,
            USERPROFILE: directory,
            PROMPTFOO_CONFIG_DIR: directory,
            PROMPTFOO_CACHE_PATH: join(directory, "cache"),
          },
          stdio: ["ignore", "ignore", "ignore", "ipc"],
          windowsHide: true,
          serialization: "json",
        },
      );
      let settled = false,
        calling = false,
        pending: Promise<void> | undefined;
      const consumed = new Set<string>();
      const finish = (error?: unknown) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener("abort", abort);
        if (error) stageAbort.abort(error);
        child.kill();
        void Promise.resolve(pending)
          .catch(() => undefined)
          .then(() => {
            if (error) reject(error);
            else resolve();
          });
      };
      const abort = () => finish(signal.reason ?? Error("Evaluation stopped"));
      signal.addEventListener("abort", abort, { once: true });
      child.once("error", finish);
      child.once("exit", () => {
        if (!settled)
          finish(Error("Promptfoo worker exited without a completed report"));
      });
      child.on("message", (raw) => {
        const message = raw as {
          kind: string;
          id?: number;
          index?: number;
          repetition?: number;
          variant?: Result["variant"];
          stats?: unknown;
          error?: string;
        };
        if (message.kind === "complete") {
          value.promptfoo.push(message.stats);
          this.save(value);
          finish();
          return;
        }
        if (message.kind === "failed") {
          finish(Error(message.error ?? "Promptfoo failed"));
          return;
        }
        if (
          message.kind !== "case" ||
          calling ||
          !Number.isSafeInteger(message.id) ||
          !plan.some(
            (item) =>
              item.index === message.index &&
              item.variant === message.variant &&
              item.repetition === message.repetition,
          )
        ) {
          finish(Error("Invalid Promptfoo provider request"));
          return;
        }
        const key = `${message.index}:${message.variant}:${message.repetition}`;
        if (consumed.has(key)) {
          finish(Error("Duplicate evaluation case dispatch"));
          return;
        }
        consumed.add(key);
        calling = true;
        pending = (async () => {
          signal.throwIfAborted();
          this.check(value);
          await this.quota.check(
            Buffer.byteLength(JSON.stringify(value)),
            value.id,
          );
          if (
            value.results.length >= suite.maxRuns ||
            value.calls >= suite.maxModelCalls ||
            value.tokens >= suite.maxTokens ||
            (value.unknownUsage && value.target.mode === "configured")
          )
            throw new RockyError(
              "evaluation_budget",
              "Evaluation budget exhausted or model usage is unknown",
              429,
            );
          const item = suite.cases[message.index!]!,
            budget = {
              ...suite.modelBudget,
              maxCalls: Math.min(
                suite.modelBudget.maxCalls,
                suite.maxModelCalls - value.calls,
              ),
              // The deterministic fixture has no model tokenizer or paid model.
              // It stays call/wall/disk bounded and can never satisfy publication.
              maxTokens:
                value.target.mode === "fixture"
                  ? null
                  : Math.min(
                      suite.modelBudget.maxTokens ?? suite.maxTokens,
                      suite.maxTokens - value.tokens,
                    ),
            };
          const provider = new RockyEvaluationProvider(this.service, {
            ...value.target,
            modelBudget: budget,
          });
          const result = await provider.callLearningCase(
            item,
            {
              evaluationId: value.id,
              caseId: item.id,
              variant: message.variant!,
              proposalId: value.proposalId,
              candidateRevision: value.candidateRevision,
              candidateHash: value.candidateHash,
              current: value.current,
            },
            signal,
          );
          signal.throwIfAborted();
          this.check(value);
          value.results.push({
            caseId: item.id,
            caseHash: intentHash(item),
            repetition: message.repetition!,
            split: item.split,
            variant: message.variant!,
            result,
          });
          value.calls += result.calls;
          value.tokens += result.tokens;
          value.unknownUsage ||= result.unknownUsage;
          if (Buffer.byteLength(JSON.stringify(value)) > suite.reportByteBudget)
            throw new RockyError(
              "evaluation_disk_budget",
              "Evaluation report budget exhausted",
              429,
            );
          await this.quota.check(
            Buffer.byteLength(JSON.stringify(value)),
            value.id,
          );
          this.save(value);
          child.send({ kind: "case_result", id: message.id, result });
        })()
          .catch((error) => finish(error))
          .finally(() => {
            calling = false;
          });
      });
      if (signal.aborted) abort();
      else child.send({ kind: "start", cases: plan });
    });
  }
  private async run(
    value: LearningEvaluation,
    suite: EvaluationSuite,
    external: AbortSignal,
  ) {
    const signal = AbortSignal.any([
      external,
      AbortSignal.timeout(suite.wallBudgetMs),
    ]);
    try {
      signal.throwIfAborted();
      this.check(value);
      value.status = "running";
      this.save(value);
      await this.stage(value, suite, ["train", "validation"], signal);
      const safety = value.results.every((item) => item.result.safetyPassed);
      const selection =
        safety && this.comparison(value, suite, "validation", true);
      if (selection) {
        const exposed = suite.cases
          .filter((item) => item.split === "holdout")
          .some((item) =>
            this.service.store.db
              .prepare(
                "SELECT 1 FROM evaluation_holdout_exposure WHERE candidate_id=? AND candidate_hash!=? AND case_hash=?",
              )
              .get(
                value.proposalId,
                value.candidateHash,
                intentHash({ prompt: item.prompt, expected: item.expected }),
              ),
          );
        value.manifest.finalHoldoutExposed = exposed;
        if (!exposed) {
          for (const item of suite.cases.filter(
            (item) => item.split === "holdout",
          ))
            this.service.store.db
              .prepare(
                "INSERT OR IGNORE INTO evaluation_holdout_exposure VALUES(?,?,?)",
              )
              .run(
                value.proposalId,
                value.candidateHash,
                intentHash({ prompt: item.prompt, expected: item.expected }),
              );
          await this.stage(value, suite, ["holdout"], signal);
        }
      }
      const incomplete =
        value.results.some(
          (item) => item.result.status === "skipped_unsafe_environment",
        ) ||
        value.unknownUsage ||
        !this.suites.adequacy(suite).sufficient ||
        value.target.mode === "fixture" ||
        value.manifest.finalHoldoutExposed === true;
      const loaded = value.results.some(
        (item) =>
          item.variant === "candidate" &&
          "loadedSkills" in item.result &&
          item.result.loadedSkills?.some(
            (event) =>
              event.kind === "domain" &&
              event.data.skillId === value.proposalId,
          ),
      );
      const negativeTriggered = value.results.some(
        (item) =>
          item.variant === "candidate" &&
          suite.cases.find((entry) => entry.id === item.caseId)?.negative &&
          "loadedSkills" in item.result &&
          (item.result.loadedSkills?.length ?? 0) > 0,
      );
      value.status = "completed";
      value.verdict =
        !safety || value.results.some((item) => !item.result.safetyPassed)
          ? "failed"
          : incomplete
            ? "insufficient_evidence"
            : loaded &&
                !negativeTriggered &&
                selection &&
                this.comparison(value, suite, "holdout", false) &&
                this.comparison(value, suite, "train", false)
              ? "passed"
              : "failed";
      value.reason =
        value.verdict === "passed"
          ? null
          : value.verdict === "insufficient_evidence"
            ? "Insufficient independent cases, fixture-only target, exposed holdout, unsafe executor or unknown usage"
            : "Required assertions, safety, improvement or holdout gate failed";
    } catch (error) {
      value.status = external.aborted ? "stopped" : "failed";
      value.verdict = "insufficient_evidence";
      value.reason =
        error instanceof Error ? error.message : "Evaluation failed";
    } finally {
      value.endedAt = new Date().toISOString();
      this.save(value);
      try {
        this.service.candidates.transition(
          value.proposalId,
          value.verdict === "passed"
            ? "needs_review"
            : value.verdict === "insufficient_evidence"
              ? "insufficient_evidence"
              : "failed",
          value.id,
          value.reason,
          value.candidateHash,
        );
      } catch {
        /* Source or candidate invalidation wins over stale completion. */
      }
    }
  }
  async stop(id: string) {
    const value = this.get(id),
      active = this.active.get(id);
    if (active) {
      active.abort.abort(Error("Owner stopped evaluation"));
      await active.promise;
    }
    const current = this.get(value.id);
    return {
      id: current.id,
      status: current.status,
      verdict: current.verdict,
      reason: current.reason,
    };
  }
  async close() {
    this.closing = true;
    for (const active of this.active.values())
      active.abort.abort(Error("Daemon shutting down"));
    await Promise.allSettled(
      [...this.active.values()].map((item) => item.promise),
    );
  }
}
