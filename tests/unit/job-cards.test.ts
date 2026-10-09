// The job cards in a conversation and the "job finished" notification read these two routes.
// Jobs are written straight into the store: no OpenCode needed.
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { JobResult } from '../../src/server/jobs/store.ts';
import { testRocky } from '../fixtures/rocky.ts';

const PORT = 4371;

const result = (changed: string[], exitCodes: number[]): JobResult => ({
  stopReason: 'end_turn',
  summary: '',
  changed,
  unapproved: [],
  mismatched: [],
  diff: '',
  checks: exitCodes.map((exitCode) => ({
    argv: ['npm', 'test'],
    exitCode,
    output: '',
  })),
  warnings: [],
});

describe('job cards and finished-job notifications', () => {
  it("lists a conversation's unsettled jobs with Rocky's own result", async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rocky-job-cards-'));
    mkdirSync(join(dir, 'data'));
    const { rocky, call: request } = testRocky({
      dataDir: join(dir, 'data'),
      port: PORT,
    });
    const call = async (path: string) => (await request(`/api${path}`)).json();
    const make = (threadId: string, title: string) =>
      rocky.jobs.create({ threadId, agent: 'opencode', title, task: 't' });

    const verified = make('t1', '修好 add');
    rocky.jobs.finish(verified.id, 'verified', result(['a.js', 'b.js'], [0]));
    const failing = make('t1', '測試沒過');
    rocky.jobs.finish(failing.id, 'problems', result(['a.js'], [0, 1]));
    const applied = make('t1', '已經套用');
    rocky.jobs.finish(applied.id, 'verified', result(['a.js'], [0]));
    rocky.jobs.setStatus(applied.id, 'applied');
    const waiting = make('t1', '還在排隊');
    make('t2', '別的對話');

    const { jobs } = (await call('/threads/t1/jobs')) as {
      jobs: {
        id: string;
        status: string;
        changed: number;
        checksPassed: boolean | null;
      }[];
    };
    expect(jobs.map((j) => j.id).sort()).toEqual(
      [verified.id, failing.id, waiting.id].sort(),
    );
    expect(jobs.find((j) => j.id === verified.id)).toMatchObject({
      status: 'verified',
      changed: 2,
      checksPassed: true,
    });
    expect(jobs.find((j) => j.id === failing.id)).toMatchObject({
      status: 'problems',
      checksPassed: false,
    });
    expect(jobs.find((j) => j.id === waiting.id)).toMatchObject({
      status: 'queued',
      changed: 0,
      checksPassed: null,
    });

    // Recently finished jobs (any conversation) for the notification; queued ones are not.
    const summary = (await call('/jobs/summary')) as {
      finished: { id: string; title: string; status: string }[];
    };
    expect(summary.finished.map((j) => j.id).sort()).toEqual(
      [verified.id, failing.id].sort(),
    );
    expect(summary.finished).toContainEqual({
      id: verified.id,
      title: '修好 add',
      status: 'verified',
    });
    rocky.db.close();
  });
});
