import { describe, expect, it } from 'vitest';
import type { Receipt } from '../../src/web/api.ts';
import {
  placeChangeCards,
  runsWithChanges,
} from '../../src/web/change-cards.ts';

const receipt = (id: string, runId: string, toolCallId: string) =>
  ({
    id,
    runId,
    toolCallId,
    actor: 'rocky',
    outcome: 'succeeded',
  }) as Receipt;

describe('change cards', () => {
  it('a turn with a transcript gets its card at the end of the turn', () => {
    const runs = runsWithChanges(
      [receipt('r1', 'run1', 'c1')],
      [{ receiptId: 'r1', path: 'a.txt' }],
    );
    const messages = [
      { role: 'user' },
      { role: 'assistant', toolCalls: [{ id: 'c1' }] },
      { role: 'tool' },
      { role: 'assistant' },
      { role: 'user' },
    ];
    const { at, unanchored } = placeChangeCards(messages, runs);
    expect(at.get(3)).toEqual([{ runId: 'run1', count: 1 }]);
    expect(unanchored).toEqual([]);
  });

  it('a turn cut off before its transcript was saved still gets its card, at the end', () => {
    const runs = runsWithChanges(
      [receipt('r1', 'lost', 'c9')],
      [
        { receiptId: 'r1', path: 'a.txt' },
        { receiptId: 'r1', path: 'b.txt' },
      ],
    );
    const { at, unanchored } = placeChangeCards([{ role: 'user' }], runs);
    expect(at.size).toBe(0);
    expect(unanchored).toEqual([{ runId: 'lost', count: 2 }]);
  });
});
