import { beforeAll, describe, expect, it } from 'vitest';
import { NOTES, runS1, type S1Report } from '../../spikes/s1-acp/scenario.ts';
import { resolveOpenCode } from '../../spikes/s1-acp/opencode.ts';

function hasOpenCode(): boolean {
  try {
    resolveOpenCode();
    return true;
  } catch (error) {
    // CI installs OpenCode and sets this, so a missing binary fails there instead of skipping.
    if (process.env['ROCKY_REQUIRE_OPENCODE'] === '1') throw error;
    return false;
  }
}

describe.runIf(hasOpenCode())('S1: opencode acp behind Rocky approvals', () => {
  let report: S1Report;
  beforeAll(async () => {
    report = await runS1();
  }, 180_000);

  it('asks Rocky before every edit and command, even with a hostile project config', () => {
    expect(report.asks.map((ask) => ask.kind)).toEqual([
      'edit',
      'edit',
      'edit',
      'execute',
      'edit',
    ]);
  });

  it('only ever answers allow_once, reject_once or cancelled', () => {
    expect(report.receipts.map((r) => r.outcome)).toEqual([
      'allow_once',
      'allow_once',
      'reject_once',
      'allow_once',
      'cancelled',
    ]);
    for (const ask of report.asks)
      expect(ask.offered).toContain('allow_always');
  });

  it('applies exactly the approved diffs, including Chinese text and CRLF', () => {
    const { verification } = report;
    expect(verification.changed.sort()).toEqual(['math.js', 'notes.md']);
    expect(verification.unapproved).toEqual([]);
    expect(verification.mismatched).toEqual([]);
    expect(verification.diff).toContain('+  return a + b;');
    const notes = report.asks[1]!.content as { newText: string }[];
    expect(notes[0]!.newText).toBe(NOTES);
  });

  it('ends the turn on reject; the reason reaches the model in the next prompt', () => {
    expect(report.secretExists).toBe(false);
    expect(report.stops['reject']).toBe('end_turn');
    expect(report.stops['reason']).toBe('end_turn');
    expect(
      report.toolResults.some((t) => t.includes('rejected permission')),
    ).toBe(true);
  });

  it('runs approved commands without Rocky secrets in the environment', () => {
    expect(report.toolResults).toContain('"undefined"');
  });

  it('cancels while a permission is open and leaves the file untouched', () => {
    expect(report.stops['cancel']).toBe('cancelled');
    expect(report.mathAfterCancel).toContain('return a + b;');
  });

  it('resumes the session in a new process with loadSession', () => {
    expect(report.replayedUserText).toContain('[edit]');
    expect(report.resumeReply).toContain('我記得');
    expect(report.stops['resume']).toBe('end_turn');
  });

  it('reports token usage with cached tokens', () => {
    expect(report.usage).toMatchObject({ cachedReadTokens: 1024 });
  });

  it('reaches no host except the npm registry (OpenCode plugin check)', () => {
    expect(report.hosts.filter((h) => h !== 'registry.npmjs.org')).toEqual([]);
  });
});
