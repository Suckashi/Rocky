import { describe, expect, it } from 'vitest';
import type { Receipt } from '../../src/server/effects/receipts.ts';
import {
  prefixKey,
  suggestedPrefix,
  suggestRules,
} from '../../src/server/effects/suggestions.ts';

const approved = (argv: string[], reason = 'mode'): Receipt =>
  ({
    id: Math.random().toString(),
    threadId: 't',
    runId: 'r',
    toolCallId: null,
    actor: 'rocky',
    effect: { kind: 'command', argv, cwd: '/p' },
    contentHash: 'h',
    decision: 'approved',
    reason,
    outcome: 'succeeded',
    detail: null,
    createdAt: 0,
    finishedAt: 0,
  }) as Receipt;

describe('rule suggestions', () => {
  it('suggests the program and its subcommand words, never just the program', () => {
    expect(suggestedPrefix(['npm', 'run', 'lint'])).toEqual([
      'npm',
      'run',
      'lint',
      '*',
    ]);
    expect(suggestedPrefix(['git', 'commit', '-m', 'x'])).toEqual([
      'git',
      'commit',
      '*',
    ]);
    expect(suggestedPrefix(['/usr/bin/git', 'log', 'src/a.ts'])).toEqual([
      '/usr/bin/git',
      'log',
      '*',
    ]);
    expect(suggestedPrefix(['node', 'script.js'])).toBeUndefined();
    expect(suggestedPrefix(['python', '-m', 'pytest'])).toBeUndefined();
  });

  it('needs two approvals and skips dangerous, outside, chained or covered commands', () => {
    const lint = ['npm', 'run', 'lint'];
    expect(suggestRules([approved(lint)], [], new Set())).toEqual([]);
    expect(
      suggestRules(
        [approved(lint), approved([...lint, '--fix'])],
        [],
        new Set(),
      ),
    ).toEqual([
      { prefix: ['npm', 'run', 'lint', '*'], count: 2, example: lint },
    ]);
    const twice = (argv: string[], reason?: string) => [
      approved(argv, reason),
      approved(argv, reason),
    ];
    expect(
      suggestRules(twice(['git', 'reset', '--hard']), [], new Set()),
    ).toEqual([]);
    expect(
      suggestRules(twice(['git', 'push', '--force']), [], new Set()),
    ).toEqual([]);
    expect(
      suggestRules(twice(['cp', 'a', '/tmp/x'], 'external'), [], new Set()),
    ).toEqual([]);
    expect(
      suggestRules(
        twice(['sh', '-c', 'npm test && npm run build']),
        [],
        new Set(),
      ),
    ).toEqual([]);
    expect(
      suggestRules(
        twice(lint),
        [{ decision: 'allow', prefix: ['npm', 'run', '*'] }],
        new Set(),
      ),
    ).toEqual([]);
    expect(
      suggestRules(
        twice(lint),
        [],
        new Set([prefixKey(['npm', 'run', 'lint', '*'])]),
      ),
    ).toEqual([]);
  });
});
