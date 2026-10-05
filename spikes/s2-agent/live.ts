// S2 live check against a real OpenAI-compatible endpoint (Ollama by default).
// Usage: node spikes/s2-agent/live.ts
//   ROCKY_S2_BASE_URL  default http://127.0.0.1:11434/v1 (Ollama)
//   ROCKY_S2_MODEL     model name, for example qwen3-coder:30b
//   ROCKY_S2_API_KEY   only for endpoints that need one
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { Command, MemorySaver } from '@langchain/langgraph';
import { ChatOpenAI } from '@langchain/openai';
import {
  createDeepAgent,
  FilesystemBackend,
  GENERAL_PURPOSE_SUBAGENT,
} from 'deepagents';
import { todoListMiddleware, type AgentMiddleware } from 'langchain';
import {
  createGateMiddleware,
  type ApprovalAnswer,
  type ApprovalRequest,
  type GateLogEntry,
} from './gate.ts';
import { AguiMapper } from './to-agui.ts';
import { ROCKY_BASE_PROMPT } from './scenario.ts';

const baseURL = process.env['ROCKY_S2_BASE_URL'] ?? 'http://127.0.0.1:11434/v1';
const model = process.env['ROCKY_S2_MODEL'];
if (!model) {
  console.error(
    'Set ROCKY_S2_MODEL, for example: $env:ROCKY_S2_MODEL="qwen3-coder:30b"',
  );
  process.exit(2);
}

const hosts = new Set<string>();
const originalFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  hosts.add(new URL(input instanceof Request ? input.url : String(input)).host);
  return originalFetch(input, init);
};

const root = mkdtempSync(join(tmpdir(), 'rocky-s2-live-'));
const gateLog: GateLogEntry[] = [];
const gate = createGateMiddleware(gateLog);
const agent = createDeepAgent({
  model: new ChatOpenAI({
    model,
    apiKey: process.env['ROCKY_S2_API_KEY'] ?? 'not-needed',
    configuration: { baseURL },
    streaming: true,
  }),
  systemPrompt: ROCKY_BASE_PROMPT,
  backend: new FilesystemBackend({ rootDir: root, virtualMode: true }),
  middleware: [todoListMiddleware() as unknown as AgentMiddleware, gate],
  subagents: [{ ...GENERAL_PURPOSE_SUBAGENT, middleware: [gate] }],
  checkpointer: new MemorySaver(),
});

const task =
  process.argv[2] ??
  '在 /notes.md 寫入三行繁體中文的待辦事項，然後讀回這個檔案，確認內容正確後告訴我結果。';
const terminal = createInterface({
  input: process.stdin,
  output: process.stdout,
});
let input: Parameters<typeof agent.stream>[0] = {
  messages: [{ role: 'user', content: task }],
};
const started = Date.now();
for (let step = 1; step <= 10; step++) {
  const mapper = new AguiMapper('live', `run-${step}`);
  const stream = await agent.stream(input, {
    configurable: { thread_id: 'live' },
    streamMode: ['messages', 'updates'],
    subgraphs: true,
  });
  for await (const item of stream) {
    mapper.push(item as [string[], string, unknown]);
    const [, mode, data] = item as [string[], string, unknown];
    if (mode === 'messages') {
      const [chunk] = data as [{ content?: unknown; getType?: () => string }];
      if (chunk.getType?.() === 'ai' && typeof chunk.content === 'string') {
        process.stdout.write(chunk.content);
      }
    }
  }
  const events = mapper.finish();
  console.log(`\n[run ${step}] ${events.length} AG-UI events`);
  if (mapper.pendingInterrupts.length === 0) break;
  const resume: Record<string, ApprovalAnswer> = {};
  for (const pending of mapper.pendingInterrupts) {
    const request = (pending.metadata as { request: ApprovalRequest }).request;
    console.log(`\nRocky wants to run ${request.tool}:`);
    console.log(JSON.stringify(request.args, null, 2));
    const reply = (await terminal.question('Allow? [y/N] '))
      .trim()
      .toLowerCase();
    resume[pending.id] = {
      decision: reply === 'y' ? 'allow' : 'reject',
      hash: request.hash,
    };
  }
  input = new Command({ resume });
}
terminal.close();

console.log('\n--- S2 live report ---');
console.log(
  `node ${process.version} on ${process.platform}; model ${model} at ${baseURL}`,
);
console.log(`elapsed ${((Date.now() - started) / 1000).toFixed(1)} s`);
console.log(
  'gate decisions:',
  gateLog.map((e) => `${e.tool}:${e.decision}`).join(', '),
);
console.log('hosts contacted:', [...hosts].join(', ') || 'none');
console.log(`files in ${root}:`);
for (const name of readdirSync(root)) {
  console.log(`== ${name}\n${readFileSync(join(root, name), 'utf8')}`);
}

// Keep-alive sockets from the HTTP client would otherwise hold the process open.
process.exit(0);
