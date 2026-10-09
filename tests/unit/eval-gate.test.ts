import { describe, expect, it } from 'vitest';
import { compareCases, summarize, type CaseSummary } from '../../evals/gate.ts';

const c = (id: string, passed: number, runs = 3): CaseSummary => ({
  id,
  passed,
  runs,
  seconds: 10,
  tokens: null,
});

describe('eval gate', () => {
  it('blocks a case that falls by half or more, even when the total score holds', () => {
    const result = compareCases(
      [c('a', 3), c('b', 2), c('c', 3), c('d', 1)],
      [c('a', 1), c('b', 0), c('c', 3), c('d', 3)],
    );
    // Total passes: 9 before, 7 after, but a and b are what matter.
    expect(result.blocking.map((r) => [r.id, r.baseline, r.now])).toEqual([
      ['a', '3/3', '1/3'],
      ['b', '2/3', '0/3'],
    ]);
    expect(result.minor).toEqual([]);
  });

  it('reports a one-run wobble without blocking, and lists new cases', () => {
    const result = compareCases([c('a', 3)], [c('a', 2), c('new', 0)]);
    expect(result.blocking).toEqual([]);
    expect(result.minor).toEqual([{ id: 'a', baseline: '3/3', now: '2/3' }]);
    expect(result.added).toEqual(['new']);
  });

  it('compares rates when the repeat count differs', () => {
    expect(compareCases([c('a', 3, 3)], [c('a', 0, 1)]).blocking).toHaveLength(
      1,
    );
    expect(compareCases([c('a', 2, 3)], [c('a', 1, 2)]).blocking).toEqual([]);
  });

  it('summarizes runs per case with average seconds and tokens', () => {
    expect(
      summarize([
        {
          id: 'a',
          passed: true,
          seconds: 10,
          tokens: { input: 100, output: 10, cached: 50 },
        },
        {
          id: 'a',
          passed: false,
          seconds: 20,
          tokens: { input: 300, output: 30, cached: 50 },
        },
        { id: 'b', passed: true, seconds: 5, tokens: null },
      ]),
    ).toEqual([
      {
        id: 'a',
        passed: 1,
        runs: 2,
        seconds: 15,
        tokens: { input: 200, output: 20, cached: 50 },
      },
      { id: 'b', passed: 1, runs: 1, seconds: 5, tokens: null },
    ]);
  });
});
