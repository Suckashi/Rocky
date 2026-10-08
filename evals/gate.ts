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

export function compareCases(
  baseline: CaseSummary[],
  current: CaseSummary[],
): { blocking: Regression[]; minor: Regression[]; added: string[] } {
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
  return { blocking, minor, added };
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
