import { describe, expect, it } from 'vitest';
import { matchesPrefix } from '../../src/server/effects/policy.ts';
import { parsePattern } from '../../src/server/http/routes/rules.ts';

describe('permanent rule patterns', () => {
  it('reads a command prefix with an optional trailing *', () => {
    expect(parsePattern('npm test *', 'allow')).toEqual({
      prefix: ['npm', 'test', '*'],
    });
    expect(parsePattern('  git   status ', 'allow')).toEqual({
      prefix: ['git', 'status'],
    });
    expect(parsePattern('node "my script.js"', 'allow')).toEqual({
      prefix: ['node', 'my script.js'],
    });
  });

  it('keeps backslashes in Windows paths, so the rule matches the real command', () => {
    const typed = 'C:\\hostedtoolcache\\node\\x64\\node.exe --version';
    const parsed = parsePattern(typed, 'allow');
    expect(parsed).toEqual({
      prefix: ['C:\\hostedtoolcache\\node\\x64\\node.exe', '--version'],
    });
    expect(
      parsePattern('"C:\\Program Files\\nodejs\\node.exe" *', 'allow'),
    ).toEqual({
      prefix: ['C:\\Program Files\\nodejs\\node.exe', '*'],
    });
    expect(
      matchesPrefix(
        ['C:\\hostedtoolcache\\node\\x64\\node.exe', '--version'],
        (parsed as { prefix: string[] }).prefix,
        true,
      ),
    ).toBe(true);
  });

  it('refuses empty, chained, misplaced * and allow-everything patterns', () => {
    expect(parsePattern('   ', 'allow')).toEqual({ error: 'empty' });
    expect(parsePattern('npm test && rm -rf x', 'allow')).toEqual({
      error: 'not-one-command',
    });
    expect(parsePattern('git * push', 'deny')).toEqual({
      error: 'star-not-last',
    });
    expect(parsePattern('*', 'allow')).toEqual({ error: 'too-broad' });
    expect(parsePattern('*', 'deny')).toEqual({ prefix: ['*'] });
  });
});
