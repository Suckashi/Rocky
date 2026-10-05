// S1 live check: OpenCode over ACP with a real model, fixing a bug and running the tests.
// Usage: node spikes/s1-acp/live.ts
//   ROCKY_S1_BASE_URL      OpenAI-compatible URL ending in /v1
//   ROCKY_S1_MODEL         model id, for example deepseek/deepseek-v4-flash
//   ROCKY_S1_API_KEY       key for that endpoint (passed to OpenCode only)
//   ROCKY_S1_AUTO_APPROVE  unset: ask in the terminal; 1: allow every request
//   ROCKY_OPENCODE_BIN     optional path to the OpenCode executable
import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { AcpAgent, type PermissionAsk } from './client.ts';
import { startHostLog } from './host-log.ts';
import { spawnOpenCode } from './opencode.ts';
import { addWorktree, verifyWorktree, type ApprovedEdit } from './worktree.ts';

const baseURL = process.env['ROCKY_S1_BASE_URL'];
const model = process.env['ROCKY_S1_MODEL'];
const autoApprove = process.env['ROCKY_S1_AUTO_APPROVE'] === '1';
if (!baseURL || !model) {
  console.error(
    'Set ROCKY_S1_BASE_URL and ROCKY_S1_MODEL (and ROCKY_S1_API_KEY).',
  );
  process.exit(2);
}

const repo = realpathSync.native(mkdtempSync(join(tmpdir(), 'rocky-s1-live-')));
const git = (...args: string[]) =>
  execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' });
git('init', '-q', '-b', 'main');
writeFileSync(
  join(repo, 'math.js'),
  'export function average(values) {\n  let total = 0;\n  for (const v of values) total += v;\n  return total / (values.length + 1);\n}\n',
);
writeFileSync(
  join(repo, 'math.test.js'),
  "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { average } from './math.js';\n\ntest('average', () => {\n  assert.equal(average([2, 4, 6]), 4);\n});\n",
);
writeFileSync(join(repo, 'package.json'), '{ "type": "module" }\n');
git('add', '.');
git(
  '-c',
  'user.name=Rocky',
  '-c',
  'user.email=rocky@localhost',
  'commit',
  '-qm',
  'init',
);
const worktree = addWorktree(repo, `${repo}-wt`, 'rocky/s1-live');

const terminal = autoApprove
  ? undefined
  : createInterface({ input: process.stdin, output: process.stdout });
const asks: PermissionAsk[] = [];
const hostLog = await startHostLog(process.env['HTTPS_PROXY']);
const agent = new AcpAgent(
  spawnOpenCode({
    home: mkdtempSync(join(tmpdir(), 'rocky-s1-live-home-')),
    cwd: worktree,
    model: {
      baseURL,
      model,
      apiKey: process.env['ROCKY_S1_API_KEY'] ?? 'not-needed',
    },
    proxy: hostLog.url,
  }),
  async (ask) => {
    asks.push(ask);
    console.log(`\nOpenCode wants to ${ask.kind}: ${ask.title}`);
    const raw = ask.rawInput as { diff?: string; command?: string } | null;
    console.log(raw?.diff ?? raw?.command ?? JSON.stringify(ask.rawInput));
    if (autoApprove) {
      console.log('Auto-approved (ROCKY_S1_AUTO_APPROVE=1)');
      return 'allow';
    }
    const reply = (await terminal!.question('Allow once? [y/N] '))
      .trim()
      .toLowerCase();
    return reply === 'y' ? 'allow' : 'reject';
  },
);

const started = Date.now();
const init = await agent.initialize();
const sessionId = await agent.newSession(worktree);
const result = await agent.prompt(
  sessionId,
  'math.test.js 失敗了。請找出 math.js 的 bug 並修好，然後用 `node --test` 跑測試確認通過。只改需要改的檔案。',
);
terminal?.close();
const elapsed = (Date.now() - started) / 1000;
const closed = await agent.close();
await hostLog.close();

const approved: ApprovedEdit[] = asks
  .filter((ask) =>
    agent.receipts.some(
      (r) => r.toolCallId === ask.toolCallId && r.outcome === 'allow_once',
    ),
  )
  .flatMap((ask) =>
    Array.isArray(ask.content)
      ? (ask.content as { type: string; path: string; newText: string }[])
          .filter((c) => c.type === 'diff')
          .map((c) => ({ path: c.path, newText: c.newText }))
      : [],
  );
const check = verifyWorktree(worktree, approved);
let testsPass: boolean;
try {
  execFileSync(process.execPath, ['--test'], { cwd: worktree, stdio: 'pipe' });
  testsPass = true;
} catch {
  testsPass = false;
}
const text = agent.updates
  .filter((n) => n.update.sessionUpdate === 'agent_message_chunk')
  .map((n) => (n.update as { content: { text?: string } }).content.text ?? '')
  .join('');

console.log('\n--- S1 live report ---');
console.log(
  `node ${process.version} on ${process.platform}; ${init.agentInfo?.name} ${init.agentInfo?.version}; model ${model} at ${baseURL}`,
);
console.log(
  `approvals: ${autoApprove ? 'automatic (ROCKY_S1_AUTO_APPROVE=1)' : 'asked in the terminal'}`,
);
console.log(
  `elapsed ${elapsed.toFixed(1)} s; stop ${result.stopReason}; OpenCode ${closed}`,
);
console.log('usage:', JSON.stringify(result.usage ?? null));
console.log(
  'permission answers:',
  agent.receipts.map((r) => `${r.kind}:${r.outcome}`).join(', ') || 'none',
);
console.log('changed files:', check.changed.join(', ') || 'none');
console.log('unapproved changes:', check.unapproved.join(', ') || 'none');
console.log(
  'changes that differ from the approved diff:',
  check.mismatched.join(', ') || 'none',
);
console.log(
  `Rocky re-ran node --test in the worktree: ${testsPass ? 'pass' : 'FAIL'}`,
);
console.log(
  'hosts contacted by OpenCode:',
  [...hostLog.hosts].join(', ') || 'none',
);
console.log(`agent said: ${text.trim().slice(0, 400)}`);
console.log(check.diff);
process.exit(0);
