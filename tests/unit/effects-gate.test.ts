import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Gate, type GateDeps } from '../../src/server/effects/gate.ts';
import { contentHash } from '../../src/server/effects/hash.ts';
import { ReceiptStore } from '../../src/server/effects/receipts.ts';
import { SnapshotStore } from '../../src/server/effects/snapshots.ts';
import type { Effect, Mode, Rule } from '../../src/server/effects/types.ts';
import { openDatabase } from '../../src/server/store/db.ts';

function setup(mode: Mode = 'ask-when-needed') {
  const dir = mkdtempSync(join(tmpdir(), 'rocky-gate-'));
  const project = mkdtempSync(join(tmpdir(), 'rocky-project-'));
  const db = openDatabase(join(dir, 'rocky.sqlite'));
  const receipts = new ReceiptStore(db);
  const changes: string[] = [];
  const rules: Rule[] = [];
  const planning = new Set<string>();
  const deps: GateDeps = {
    receipts,
    projectRoot: () => project,
    mode: () => mode,
    rules: () => rules,
    addRule: (rule) => rules.push(rule),
    planning: (threadId) => planning.has(threadId),
    setPlanning: (threadId, on) =>
      on ? planning.add(threadId) : planning.delete(threadId),
    createdByRocky: () => false,
  };
  const gate = new Gate(deps);
  gate.subscribe('t1', () => changes.push('t1'));
  return { gate, receipts, project, db, dir, changes, rules, planning };
}

const origin = { threadId: 't1', actor: 'rocky' as const, toolCallId: 'c1' };
const until = async (check: () => boolean) => {
  for (let i = 0; i < 100 && !check(); i++)
    await new Promise((r) => setTimeout(r, 5));
};

describe('Gate', () => {
  it('allows without asking, records an intent receipt and issues a single-use pass', async () => {
    const { gate, project } = setup('ask-when-needed');
    const effect: Effect = {
      kind: 'write',
      path: join(project, 'a.txt'),
      operation: 'create',
      content: 'hi',
    };
    const result = await gate.request(effect, origin);
    expect(result.allowed).toBe(true);
    if (!result.allowed) return;
    expect(result.receipt).toMatchObject({
      decision: 'allowed',
      outcome: 'pending',
      actor: 'rocky',
    });
    gate.passes.redeem(result.pass, contentHash(effect));
    expect(() => gate.passes.redeem(result.pass, contentHash(effect))).toThrow(
      'pass-unknown-or-used',
    );
  });

  it('refuses a pass for different content (second line of defence)', async () => {
    const { gate, project } = setup('ask-when-needed');
    const effect: Effect = {
      kind: 'write',
      path: join(project, 'a.txt'),
      operation: 'create',
      content: 'hi',
    };
    const result = await gate.request(effect, origin);
    if (!result.allowed) throw new Error('expected allowed');
    expect(() =>
      gate.passes.redeem(
        result.pass,
        contentHash({ ...effect, content: 'evil' }),
      ),
    ).toThrow('pass-content-mismatch');
  });

  it('asks, waits for the user, and binds the approval to the content hash', async () => {
    const { gate, project, changes } = setup();
    const effect: Effect = {
      kind: 'command',
      argv: ['git', 'push', '--force'],
      cwd: project,
    };
    const promise = gate.request(effect, origin);
    await until(() => gate.pending('t1').length === 1);
    const [pending] = gate.pending('t1');
    expect(pending).toMatchObject({
      reason: 'dangerous',
      grant: 'dangerous:force-push',
      always: ['git', 'push', '*'],
      toolCallId: 'c1',
      actor: 'rocky',
    });
    expect(
      gate.answer(pending!.id, {
        decision: 'allow-once',
        contentHash: pending!.contentHash,
      }),
    ).toBe(true);
    const result = await promise;
    expect(result.allowed).toBe(true);
    expect(result.receipt?.decision).toBe('approved');
    expect(gate.pending('t1')).toEqual([]);
    expect(changes).toEqual(['t1', 't1']);
  });

  it('treats an answer for other content as a rejection', async () => {
    const { gate, project } = setup();
    const promise = gate.request(
      { kind: 'command', argv: ['git', 'push', '--force'], cwd: project },
      origin,
    );
    await until(() => gate.pending('t1').length === 1);
    gate.answer(gate.pending('t1')[0]!.id, {
      decision: 'allow-once',
      contentHash: 'something-else',
    });
    const result = await promise;
    expect(result.allowed).toBe(false);
    expect(result.receipt).toMatchObject({
      decision: 'rejected',
      outcome: 'not-run',
      detail: 'content-changed',
    });
  });

  it('passes the rejection reason to the model and records not-run', async () => {
    const { gate, project } = setup();
    const promise = gate.request(
      { kind: 'command', argv: ['git', 'push', '--force'], cwd: project },
      origin,
    );
    await until(() => gate.pending('t1').length === 1);
    const pending = gate.pending('t1')[0]!;
    gate.answer(pending.id, {
      decision: 'reject',
      contentHash: pending.contentHash,
      reason: '先不要裝套件',
    });
    const result = await promise;
    expect(result.allowed).toBe(false);
    if (result.allowed) return;
    expect(result.message).toContain('先不要裝套件');
    expect(result.message).toContain('choose a different approach');
    expect(result.receipt).toMatchObject({
      outcome: 'not-run',
      decision: 'rejected',
    });
  });

  it('"allow for this conversation" covers the category, answers waiting questions of it, and stays in the thread', async () => {
    const { gate, project } = setup();
    const push = (...rest: string[]): Effect => ({
      kind: 'command',
      argv: ['git', 'push', '--force', ...rest],
      cwd: project,
    });
    const first = gate.request(push(), origin);
    const sibling = gate.request(push('origin', 'dev'), {
      ...origin,
      toolCallId: 'c2',
    });
    await until(() => gate.pending('t1').length === 2);
    const pending = gate.pending('t1')[0]!;
    gate.answer(pending.id, {
      decision: 'allow-session',
      contentHash: pending.contentHash,
    });
    expect((await first).allowed).toBe(true);
    // The other force push already waiting is answered by the same grant.
    expect((await sibling).allowed).toBe(true);
    expect((await gate.request(push('origin', 'main'), origin)).allowed).toBe(
      true,
    );
    // Another category still asks.
    const other = gate.request(
      { kind: 'command', argv: ['rm', '-rf', 'build'], cwd: project },
      origin,
    );
    await until(() => gate.pending('t1').length === 1);
    gate.answer(gate.pending('t1')[0]!.id, {
      decision: 'reject',
      contentHash: '',
    });
    await other;
    // Another conversation does not inherit it.
    const elsewhere = gate.request(push(), { ...origin, threadId: 't2' });
    await until(() => gate.pending('t2').length === 1);
    gate.answer(gate.pending('t2')[0]!.id, {
      decision: 'reject',
      contentHash: '',
    });
    expect((await elsewhere).allowed).toBe(false);
  });

  it('"always allow" saves the shown rule, so later commands it covers do not ask', async () => {
    const { gate, project, rules } = setup();
    const effect: Effect = {
      kind: 'command',
      argv: ['git', 'push', '--force', 'origin', 'main'],
      cwd: project,
    };
    const first = gate.request(effect, origin);
    await until(() => gate.pending('t1').length === 1);
    const pending = gate.pending('t1')[0]!;
    gate.answer(pending.id, {
      decision: 'allow-always',
      contentHash: pending.contentHash,
    });
    expect((await first).allowed).toBe(true);
    expect(rules).toEqual([
      { decision: 'allow', prefix: ['git', 'push', '*'] },
    ]);
    const again = await gate.request(effect, { ...origin, threadId: 't9' });
    expect(again.allowed && again.receipt?.reason).toBe('allow-rule');
  });

  it('plan mode refuses changes, asks for the plan, and turns itself off when an option is chosen', async () => {
    const { gate, project, planning } = setup('hands-off');
    planning.add('t1');
    const write = await gate.request(
      {
        kind: 'write',
        path: join(project, 'a.txt'),
        operation: 'create',
        content: 'x',
      },
      origin,
    );
    expect(write.allowed).toBe(false);
    if (!write.allowed) expect(write.message).toContain('plan mode');
    const plan: Effect = {
      kind: 'plan',
      title: 'Refactor',
      options: [{ title: 'Small', summary: 's', steps: ['a'] }],
    };
    const asked = gate.request(plan, origin);
    await until(() => gate.pending('t1').length === 1);
    const pending = gate.pending('t1')[0]!;
    gate.answer(pending.id, {
      decision: 'choose',
      contentHash: pending.contentHash,
      option: 0,
    });
    expect(await asked).toMatchObject({ allowed: true, choice: 0 });
    expect(planning.has('t1')).toBe(false);
    // Outside plan mode there is no plan to propose.
    expect((await gate.request(plan, origin)).allowed).toBe(false);
  });

  it('cancels a pending question when the run stops', async () => {
    const { gate, project } = setup();
    const controller = new AbortController();
    const promise = gate.request(
      { kind: 'command', argv: ['git', 'push', '--force'], cwd: project },
      origin,
      controller.signal,
    );
    await until(() => gate.pending('t1').length === 1);
    controller.abort();
    const result = await promise;
    expect(result.allowed).toBe(false);
    expect(gate.pending('t1')).toEqual([]);
    expect(result.receipt?.detail).toBe('stopped');
  });

  it('asks before reading a secret even in hands-off, and reads ordinary files without a receipt', async () => {
    const { gate, project, receipts } = setup('hands-off');
    const secret = gate.request(
      { kind: 'read', path: join(project, '.env') },
      origin,
    );
    await until(() => gate.pending('t1').length === 1);
    expect(gate.pending('t1')[0]).toMatchObject({
      reason: 'secret',
      grant: 'secret:read',
    });
    gate.answer(gate.pending('t1')[0]!.id, {
      decision: 'reject',
      contentHash: '',
    });
    expect((await secret).allowed).toBe(false);
    const read = await gate.request(
      { kind: 'read', path: join(project, 'README.md') },
      origin,
    );
    expect(read).toMatchObject({ allowed: true, receipt: undefined });
    expect(receipts.forThread('t1').map((r) => r.decision)).toEqual([
      'rejected',
    ]);
  });

  it('marks pending receipts unknown after a restart and lets the user confirm them', () => {
    const { receipts } = setup();
    const r = receipts.intent(
      origin,
      { kind: 'command', argv: ['npm', 'test'], cwd: '/x' },
      { contentHash: 'h', reason: 'mode' },
      'allowed',
    );
    expect(receipts.markInterrupted()).toBe(1);
    expect(receipts.get(r.id)?.outcome).toBe('unknown');
    expect(() => receipts.finish(r.id, 'succeeded')).toThrow('not pending');
    expect(receipts.confirm(r.id)).toBe(true);
    expect(receipts.get(r.id)?.outcome).toBe('succeeded');
  });

  it('stores snapshots by content and reads them back', () => {
    const { db, dir, receipts } = setup();
    const snapshots = new SnapshotStore(db, dir);
    const sha = snapshots.put(Buffer.from('原本的內容'));
    expect(snapshots.put(Buffer.from('原本的內容'))).toBe(sha);
    expect(snapshots.read(sha).toString()).toBe('原本的內容');
    const r = receipts.intent(
      origin,
      { kind: 'write', path: '/x', operation: 'edit', content: 'n' },
      { contentHash: 'h', reason: 'mode' },
      'allowed',
    );
    snapshots.record({
      receiptId: r.id,
      path: '/x',
      beforeSha: sha,
      afterSha: null,
    });
    expect(snapshots.forReceipts([r.id])).toEqual([
      { receiptId: r.id, path: '/x', beforeSha: sha, afterSha: null },
    ]);
  });
});
