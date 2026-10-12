import { describe, expect, it } from 'vitest';
import { runFailure } from '../../src/web/run-errors.ts';

describe('a run the server refused', () => {
  it('names a conversation that grew too long, and passes other errors through', () => {
    const tooLong = Object.assign(new Error('HTTP 413'), { status: 413 });
    expect(runFailure(tooLong)).toEqual({ key: 'chat.error.too-long' });
    const other = Object.assign(new Error('HTTP 500: internal'), {
      status: 500,
    });
    expect(runFailure(other)).toEqual({
      key: 'chat.error',
      params: { error: 'HTTP 500: internal' },
    });
    expect(runFailure('offline')).toEqual({
      key: 'chat.error',
      params: { error: 'offline' },
    });
  });
});
