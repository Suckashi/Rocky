import { describe, expect, it } from 'vitest';
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
