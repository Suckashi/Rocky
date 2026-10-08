import { describe, expect, it } from 'vitest';
import { diffLines, withContext } from '../../src/web/diff.ts';

describe('line diff', () => {
  it('marks changed lines and keeps the rest', () => {
    expect(diffLines('a\nb\nc\n', 'a\nB\nc\nd\n')).toEqual([
      { kind: 'same', text: 'a' },
      { kind: 'del', text: 'b' },
      { kind: 'add', text: 'B' },
      { kind: 'same', text: 'c' },
      { kind: 'add', text: 'd' },
    ]);
  });

  it('treats CRLF like LF and handles created and deleted files', () => {
    expect(
      diffLines('x\r\ny\r\n', 'x\ny\n').every((l) => l.kind === 'same'),
    ).toBe(true);
    expect(diffLines(null, 'new\n')).toEqual([{ kind: 'add', text: 'new' }]);
    expect(diffLines('old\n', null)).toEqual([{ kind: 'del', text: 'old' }]);
  });

  it('folds unchanged lines far from a change', () => {
    const before = Array.from({ length: 20 }, (_, i) => `l${i}`).join('\n');
    const after = before.replace('l10', 'L10');
    const rows = withContext(diffLines(before, after), 2);
    expect(rows[0]).toEqual({ kind: 'gap', count: 8 });
    expect(rows.filter((r) => r.kind !== 'gap')).toHaveLength(6);
    expect(rows.at(-1)).toEqual({ kind: 'gap', count: 7 });
  });
});
