// The eval gate: compares each case with the baseline instead of one total score, so a
// case that breaks cannot hide behind another that got luckier this time.

export interface Tokens {
  input: number;
  output: number;
  cached: number;
}

/** One case over all repeats. Tokens and seconds are averages per run. */
export interface CaseSummary {
  id: string;
  passed: number;
  runs: number;
  seconds: number;
  tokens: Tokens | null;
}

export interface Regression {
  id: string;
  baseline: string;
  now: string;
}

/** A case regresses when its pass rate falls by half or more (3/3 to 1/3, 2/3 to 0/3).
 * Smaller drops are within what one model run varies; they are reported, not blocked. */
export const BLOCKING_DROP = 0.5;

const rate = (c: CaseSummary) => (c.runs > 0 ? c.passed / c.runs : 0);
const label = (c: CaseSummary) => `${c.passed}/${c.runs}`;

/** `missing`: baseline cases still in the suite with no scored run now (every run ended by
 * a provider error). Nothing can be said about them, so the gate cannot pass. Cases the run
 * skipped on purpose (`skipped`, e.g. OpenCode not installed) are left out; cases no longer
 * in the suite (`suite`) are `removed`, reported but not blocking. */
export function compareCases(
  baseline: CaseSummary[],
  current: CaseSummary[],
  skipped: string[] = [],
  suite?: string[],
): {
  blocking: Regression[];
  minor: Regression[];
  added: string[];
  missing: string[];
  removed: string[];
} {
  const before = new Map(baseline.map((c) => [c.id, c]));
  const blocking: Regression[] = [];
  const minor: Regression[] = [];
  const added: string[] = [];
  for (const now of current) {
    const was = before.get(now.id);
    if (!was) {
      added.push(now.id);
      continue;
    }
    const drop = rate(was) - rate(now);
    if (drop <= 0) continue;
    const entry = { id: now.id, baseline: label(was), now: label(now) };
    (drop >= BLOCKING_DROP - 1e-9 ? blocking : minor).push(entry);
  }
  const now = new Set(current.map((c) => c.id));
  const absent = baseline
    .map((c) => c.id)
    .filter((id) => !now.has(id) && !skipped.includes(id));
  const removed = suite ? absent.filter((id) => !suite.includes(id)) : [];
  const missing = absent.filter((id) => !removed.includes(id));
  return { blocking, minor, added, missing, removed };
}

/** Per-case totals from individual runs, in first-seen order. */
export function summarize(
  results: {
    id: string;
    passed: boolean;
    seconds: number;
    tokens: Tokens | null;
  }[],
): CaseSummary[] {
  const byId = new Map<string, typeof results>();
  for (const r of results) byId.set(r.id, [...(byId.get(r.id) ?? []), r]);
  return [...byId.entries()].map(([id, runs]) => {
    const withTokens = runs.flatMap((r) => (r.tokens ? [r.tokens] : []));
    const average = (pick: (t: Tokens) => number) =>
      Math.round(
        withTokens.reduce((sum, t) => sum + pick(t), 0) / withTokens.length,
      );
    return {
      id,
      passed: runs.filter((r) => r.passed).length,
      runs: runs.length,
      seconds:
        Math.round(
          (runs.reduce((s, r) => s + r.seconds, 0) / runs.length) * 10,
        ) / 10,
      tokens: withTokens.length
        ? {
            input: average((t) => t.input),
            output: average((t) => t.output),
            cached: average((t) => t.cached),
          }
        : null,
    };
  });
}

/** A run that ended because the model provider failed (an HTTP error status, a dropped
 * connection), not because Rocky did the task wrong. These runs are reported apart and left
 * out of the score: they say nothing about Rocky (ADR 0026). */
export function isProviderError(error: string): boolean {
  return (
    /^[45]\d\d\b/.test(error.trim()) ||
    /\b(terminated|ECONNRESET|ETIMEDOUT|socket hang up|fetch failed)\b/i.test(
      error,
    )
  );
}
