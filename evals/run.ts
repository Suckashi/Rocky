// Eval runner: runs every case against a real model through Rocky's own server, tools and
// gate, then checks the result on disk. Not part of CI (needs a live model). Usage:
//   ROCKY_EVAL_BASE_URL  OpenAI-compatible URL ending in /v1
//   ROCKY_EVAL_MODEL     model name, for example deepseek/deepseek-v4-flash
//   ROCKY_EVAL_API_KEY   only for endpoints that need one
//   npm run eval -- [--only <case-id>] [--repeat N] [--save-baseline]
// Approvals are rejected automatically (with the case's reason) and counted.
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { composeRocky } from '../src/server/compose.ts';
import { findOpenCode } from '../src/server/external/opencode.ts';
import { EgressGuard } from '../src/server/platform/egress.ts';
import { CASES, type Case, type CaseContext } from './cases.ts';

const baseURL = process.env['ROCKY_EVAL_BASE_URL'];
const model = process.env['ROCKY_EVAL_MODEL'];
const apiKey = process.env['ROCKY_EVAL_API_KEY'];
if (!baseURL || !model) {
  console.error('Set ROCKY_EVAL_BASE_URL and ROCKY_EVAL_MODEL.');
  process.exit(2);
}
const args = process.argv.slice(2);
const only = args.includes('--only')
  ? args[args.indexOf('--only') + 1]
  : undefined;
const saveBaseline = args.includes('--save-baseline');
// Models vary between runs; repeating each case makes the score steadier.
const repeat = args.includes('--repeat')
  ? Math.max(1, Number(args[args.indexOf('--repeat') + 1]) || 1)
  : 1;
const CASE_TIMEOUT_MS = 5 * 60_000;
const PORT = 4399;
const HOST = `127.0.0.1:${PORT}`;
const token = 'e'.repeat(43);

interface Result {
  id: string;
  passed: boolean;
  problems: string[];
  seconds: number;
  tools: string[];
  asked: number;
  /** What Rocky did, from the receipts: effect, decision, outcome. */
  actions: string[];
  error?: string;
}

type Event = { type: string; [key: string]: unknown };

async function runCase(c: Case): Promise<Result> {
  const root = mkdtempSync(join(tmpdir(), `rocky-eval-${c.id}-`));
  const dir = join(root, 'project');
  for (const [path, content] of Object.entries(c.files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), content);
  }
  for (const [path, make] of Object.entries(c.documents ?? {})) {
    writeFileSync(join(dir, path), await make());
  }
  if (c.git) {
    for (const a of [
      ['init', '-q'],
      ['config', 'user.email', 'eval@example.com'],
      ['config', 'user.name', 'eval'],
      ['add', '-A'],
      ['commit', '-q', '-m', 'init'],
    ])
      execFileSync('git', ['-C', dir, ...a]);
  }
  mkdirSync(join(root, 'data'));
  const rocky = composeRocky({
    dataDir: join(root, 'data'),
    token,
    port: PORT,
    egress: new EgressGuard(() => {}),
  });
  rocky.settings.setModel(
    { provider: 'openai-compatible', baseURL: baseURL!, model: model! },
    apiKey,
  );
  rocky.settings.setProject(dir);
  rocky.settings.setMode('ask-when-needed');

  const threadId = `eval-${c.id}`;
  const asked: CaseContext['asked'] = [];
  rocky.gate.subscribe(threadId, () => {
    for (const approval of rocky.gate.pending(threadId)) {
      asked.push({ summary: JSON.stringify(approval.effect).slice(0, 200) });
      rocky.gate.answer(
        approval.id,
        c.approve?.(approval.effect)
          ? { decision: 'allow-once', contentHash: approval.contentHash }
          : {
              decision: 'reject',
              contentHash: approval.contentHash,
              reason: c.rejectReason ?? 'Not approved in this evaluation.',
            },
      );
    }
  });

  const started = Date.now();
  const timeout = AbortSignal.timeout(CASE_TIMEOUT_MS);
  let events: Event[] = [];
  let error: string | undefined;
  try {
    const res = await rocky.app.request(
      `http://${HOST}/api/copilotkit/agent/rocky/run`,
      {
        method: 'POST',
        signal: timeout,
        headers: {
          host: HOST,
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          threadId,
          runId: `${threadId}-run`,
          messages: [{ id: `${threadId}-u`, role: 'user', content: c.prompt }],
          tools: [],
          context: [],
          state: {},
          forwardedProps: {},
        }),
      },
    );
    events = (await res.text())
      .split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => JSON.parse(line.slice(5).trim()) as Event);
    const failure = events.find((e) => e.type === 'RUN_ERROR');
    if (failure) error = String(failure['message'] ?? failure['code']);
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }
  const seconds = Math.round((Date.now() - started) / 100) / 10;

  // The reply is the text after the last tool call: what Rocky finally told the user.
  const lastTool = events.findLastIndex((e) => e.type === 'TOOL_CALL_RESULT');
  const reply = events
    .slice(lastTool + 1)
    .filter((e) => e.type === 'TEXT_MESSAGE_CONTENT')
    .map((e) => String(e['delta']))
    .join('');
  const tools = events
    .filter((e) => e.type === 'TOOL_CALL_START')
    .map((e) => String(e['toolCallName']));
  const receipts = rocky.receipts.forThread(threadId);
  const problems = error
    ? [`run failed: ${error}`]
    : await c.check({
        dir,
        reply,
        tools,
        receipts,
        asked,
        jobs: rocky.jobs.list(),
        memories: rocky.memory.list(),
      });
  rocky.db.close();
  return {
    id: c.id,
    passed: problems.length === 0,
    problems,
    seconds,
    tools,
    asked: asked.length,
    actions: receipts.map(
      (r) =>
        `${r.decision}/${r.outcome} ${r.effect.kind === 'command' ? JSON.stringify(r.effect.argv) : r.effect.kind === 'write' ? `${r.effect.operation} ${r.effect.path}` : r.effect.kind}`,
    ),
    ...(error ? { error } : {}),
  };
}

const hasOpenCode = findOpenCode() !== undefined;
const skipped = CASES.filter((c) => c.needs === 'opencode' && !hasOpenCode);
for (const c of skipped)
  console.log(`${c.id} … SKIPPED (OpenCode not installed)`);
const cases = CASES.filter(
  (c) => (!only || c.id === only) && !skipped.includes(c),
);
const results: Result[] = [];
for (let round = 1; round <= repeat; round++) {
  for (const c of cases) {
    process.stdout.write(`${c.id}${repeat > 1 ? ` #${round}` : ''} … `);
    const result = await runCase(c);
    results.push(result);
    console.log(
      `${result.passed ? 'PASS' : 'FAIL'} (${result.seconds}s, tools: ${result.tools.join(', ') || 'none'}, asked: ${result.asked})` +
        (result.problems.length
          ? `\n    ${result.problems.join('\n    ')}`
          : ''),
    );
  }
}
const passed = results.filter((r) => r.passed).length;
const score = Math.round((passed / results.length) * 1000) / 1000;
const summary = {
  model,
  baseURL,
  platform: `${process.platform} ${process.arch}`,
  node: process.version,
  date: new Date().toISOString(),
  score,
  passed,
  total: results.length,
  repeat,
  skipped: skipped.map((c) => c.id),
  results,
};
console.log(`\nscore ${passed}/${results.length} = ${score} (${model})`);

const here = import.meta.dirname;
mkdirSync(join(here, 'results'), { recursive: true });
writeFileSync(
  join(here, 'results', 'latest.json'),
  `${JSON.stringify(summary, null, 2)}\n`,
);
const baselineFile = join(here, 'baseline.json');
if (saveBaseline && !only) {
  writeFileSync(baselineFile, `${JSON.stringify(summary, null, 2)}\n`);
  console.log('baseline saved');
} else if (!only) {
  try {
    const baseline = JSON.parse(readFileSync(baselineFile, 'utf8')) as {
      score: number;
      model: string;
    };
    if (baseline.model !== model) {
      console.log(`baseline is for ${baseline.model}; not compared`);
    } else if (score < baseline.score) {
      console.error(`score dropped below the baseline (${baseline.score})`);
      process.exit(1);
    } else {
      console.log(`baseline ${baseline.score}: no drop`);
    }
  } catch {
    console.log('no baseline yet (run with --save-baseline)');
  }
}
