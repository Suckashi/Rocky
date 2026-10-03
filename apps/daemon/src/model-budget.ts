import { z } from "zod";
import { Store } from "./store.js";
import { idSchema, RockyError } from "../../../packages/contracts/src/index.js";
import {
  modelBudgetSchema,
  modelReservationSchema,
  tokenUsageSchema,
  modelUsageEntrySchema as entrySchema,
  modelUsageSnapshotSchema,
  type ModelBudget,
  type TokenUsage,
} from "../../../packages/contracts/src/model-budget.js";

type Entry = z.infer<typeof entrySchema>;

// Integer micro-USD, rounded upwards. These are configured-price estimates, not invoices.
export function pricedMicroUsd(
  usage: TokenUsage,
  pricing: NonNullable<ModelBudget["pricing"]>,
) {
  const numerator =
    BigInt(usage.inputTokens) * BigInt(pricing.inputMicroUsdPerMillion) +
    BigInt(usage.outputTokens) * BigInt(pricing.outputMicroUsdPerMillion);
  return Number((numerator + 999999n) / 1000000n);
}

/** One durable root-run budget shared by every model purpose and native child. */
export class ModelBudgetLedger {
  constructor(private readonly store: Store) {}
  open(runId: string, input: unknown = {}) {
    idSchema.parse(runId);
    const budget = modelBudgetSchema.parse(input);
    const existing = this.store.db
      .prepare("SELECT data FROM model_budgets WHERE run_id=?")
      .get(runId) as { data: string } | undefined;
    if (
      existing &&
      JSON.stringify(modelBudgetSchema.parse(JSON.parse(existing.data))) !==
        JSON.stringify(budget)
    )
      throw new RockyError("budget_conflict", "Run budget is immutable", 409);
    this.store.db
      .prepare("INSERT OR IGNORE INTO model_budgets VALUES(?,?)")
      .run(runId, JSON.stringify(budget));
  }
  private entries(runId: string): Entry[] {
    return (
      this.store.db
        .prepare("SELECT data FROM model_usage WHERE run_id=? ORDER BY rowid")
        .all(runId) as { data: string }[]
    ).map((row) => entrySchema.parse(JSON.parse(row.data)));
  }
  snapshot(runId: string) {
    idSchema.parse(runId);
    const row = this.store.db
      .prepare("SELECT data FROM model_budgets WHERE run_id=?")
      .get(runId) as { data: string } | undefined;
    if (!row)
      throw new RockyError("budget_not_found", "Run has no model budget", 404);
    const budget = modelBudgetSchema.parse(JSON.parse(row.data));
    const entries = this.entries(runId);
    let inputTokens = 0,
      outputTokens = 0,
      heldTokens = 0,
      heldMicroUsd = 0n,
      knownEstimatedMicroUsd = 0n,
      unknownUsageCalls = 0;
    for (const entry of entries) {
      const bounds =
        entry.inputTokenBound !== null && entry.outputTokenBound !== null
          ? {
              inputTokens: entry.inputTokenBound,
              outputTokens: entry.outputTokenBound,
            }
          : null;
      const charged = entry.usage ?? bounds;
      if (entry.usage) {
        inputTokens += entry.usage.inputTokens;
        outputTokens += entry.usage.outputTokens;
        if (budget.pricing)
          knownEstimatedMicroUsd += BigInt(
            pricedMicroUsd(entry.usage, budget.pricing),
          );
      } else unknownUsageCalls++;
      if (charged) {
        heldTokens += charged.inputTokens + charged.outputTokens;
        if (budget.pricing)
          heldMicroUsd += BigInt(pricedMicroUsd(charged, budget.pricing));
      }
    }
    return modelUsageSnapshotSchema.parse({
      runId,
      budget,
      calls: entries.length,
      knownUsage: { inputTokens, outputTokens },
      unknownUsageCalls,
      heldTokens,
      heldMicroUsd: heldMicroUsd.toString(),
      knownEstimatedMicroUsd: budget.pricing
        ? knownEstimatedMicroUsd.toString()
        : null,
      entries,
    });
  }
  reserve(runId: string, input: unknown) {
    const reservation = modelReservationSchema.parse(input);
    return this.store.transaction(() => {
      const snapshot = this.snapshot(runId);
      const previous = snapshot.entries.find(
        (e) => e.requestId === reservation.requestId,
      );
      // A reservation is a dispatch fence, not authorization to resend an unknown request.
      if (previous)
        throw new RockyError(
          "model_request_replay",
          "Model request was already reserved; do not resend",
          409,
        );
      const { budget } = snapshot;
      if (
        (budget.maxTokens !== null || budget.maxMicroUsd !== null) &&
        (reservation.inputTokenBound === null ||
          reservation.outputTokenBound === null)
      )
        throw new RockyError(
          "token_bound_required",
          "A token or cost budget requires trusted token bounds",
          422,
        );
      const tokens =
        (reservation.inputTokenBound ?? 0) +
        (reservation.outputTokenBound ?? 0);
      const cost = budget.pricing
        ? pricedMicroUsd(
            {
              inputTokens: reservation.inputTokenBound ?? 0,
              outputTokens: reservation.outputTokenBound ?? 0,
            },
            budget.pricing,
          )
        : 0;
      if (
        snapshot.calls >= budget.maxCalls ||
        (budget.maxTokens !== null &&
          snapshot.heldTokens + tokens > budget.maxTokens) ||
        (budget.maxMicroUsd !== null &&
          BigInt(snapshot.heldMicroUsd) + BigInt(cost) >
            BigInt(budget.maxMicroUsd))
      )
        throw new RockyError(
          "model_budget_exhausted",
          "Root model budget exhausted before dispatch",
          429,
        );
      const entry: Entry = { ...reservation, status: "reserved", usage: null };
      this.store.db
        .prepare("INSERT INTO model_usage VALUES(?,?,?)")
        .run(runId, reservation.requestId, JSON.stringify(entry));
      return entry;
    });
  }
  settle(runId: string, requestId: string, input: unknown) {
    idSchema.parse(runId);
    idSchema.parse(requestId);
    const usage = input === null ? null : tokenUsageSchema.parse(input);
    return this.store.transaction(() => {
      const row = this.store.db
        .prepare("SELECT data FROM model_usage WHERE run_id=? AND request_id=?")
        .get(runId, requestId) as { data: string } | undefined;
      if (!row)
        throw new RockyError(
          "reservation_required",
          "Model usage requires a dispatch reservation",
          409,
        );
      const entry = entrySchema.parse(JSON.parse(row.data));
      if (
        entry.status === "settled" &&
        JSON.stringify(entry.usage) !== JSON.stringify(usage)
      )
        throw new RockyError(
          "usage_conflict",
          "Usage already settled differently",
          409,
        );
      entry.status = "settled";
      entry.usage = usage;
      this.store.db
        .prepare(
          "UPDATE model_usage SET data=? WHERE run_id=? AND request_id=?",
        )
        .run(JSON.stringify(entry), runId, requestId);
      return entry;
    });
  }
}
