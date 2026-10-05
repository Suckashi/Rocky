// S2 live check against a real model.
// Usage: node spikes/s2-agent/live.ts [task]
//   ROCKY_S2_PROVIDER      openai (default, any OpenAI-compatible endpoint) or anthropic
//   ROCKY_S2_BASE_URL      openai: default http://127.0.0.1:11434/v1 (Ollama);
//                          anthropic: API root without /v1, for example https://api.commandcode.ai/provider
//   ROCKY_S2_MODEL         model name, for example deepseek/deepseek-v4-flash
//   ROCKY_S2_API_KEY       only for endpoints that need one
//   ROCKY_S2_AUTO_APPROVE  unset: ask in the terminal; 1: allow every request;
//                          reject-first: reject the first request, allow the rest
import { existsSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { Command, MemorySaver } from '@langchain/langgraph';
import { ChatAnthropic } from '@langchain/anthropic';
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

const provider = process.env['ROCKY_S2_PROVIDER'] ?? 'openai';
const baseURL = process.env['ROCKY_S2_BASE_URL'] ?? 'http://127.0.0.1:11434/v1';
const apiKey = process.env['ROCKY_S2_API_KEY'] ?? 'not-needed';
const model = process.env['ROCKY_S2_MODEL'];
const autoApprove = process.env['ROCKY_S2_AUTO_APPROVE'];
if (!model) {
  console.error(
    'Set ROCKY_S2_MODEL, for example: $env:ROCKY_S2_MODEL="qwen3-coder:30b"',
  );
  process.exit(2);
}
if (provider !== 'openai' && provider !== 'anthropic') {
  console.error('ROCKY_S2_PROVIDER must be openai or anthropic');
  process.exit(2);
}
if (autoApprove && autoApprove !== '1' && autoApprove !== 'reject-first') {
  console.error('ROCKY_S2_AUTO_APPROVE must be 1 or reject-first');
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
const chatModel =
  provider === 'anthropic'
    ? new ChatAnthropic({
        model,
        apiKey,
        anthropicApiUrl: baseURL,
        streaming: true,
      })
    : new ChatOpenAI({
        model,
        apiKey,
        configuration: { baseURL },
        streaming: true,
      });
const agent = createDeepAgent({
  model: chatModel,
  systemPrompt: ROCKY_BASE_PROMPT,
  backend: new FilesystemBackend({ rootDir: root, virtualMode: true }),
  middleware: [todoListMiddleware() as unknown as AgentMiddleware, gate],
  subagents: [{ ...GENERAL_PURPOSE_SUBAGENT, middleware: [gate] }],
  checkpointer: new MemorySaver(),
});

const task =
  process.argv[2] ??
  '在 /notes.md 寫入三行繁體中文的待辦事項，然後讀回這個檔案，確認內容正確後告訴我結果。';
const terminal = autoApprove
  ? undefined
  : createInterface({ input: process.stdin, output: process.stdout });
let answered = 0;
async function ask(request: ApprovalRequest): Promise<ApprovalAnswer> {
  answered++;
  if (autoApprove === 'reject-first' && answered === 1) {
    console.log('Auto-rejected (ROCKY_S2_AUTO_APPROVE=reject-first)');
    return {
      decision: 'reject',
      hash: request.hash,
      reason: '不要建立或修改任何檔案，請直接在回覆中列出內容。',
    };
  }
  if (autoApprove) {
    console.log(`Auto-approved (ROCKY_S2_AUTO_APPROVE=${autoApprove})`);
    return { decision: 'allow', hash: request.hash };
  }
  const reply = (await terminal!.question('Allow? [y/N] '))
    .trim()
    .toLowerCase();
  return { decision: reply === 'y' ? 'allow' : 'reject', hash: request.hash };
}
const usage = { calls: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
const toolCalls: string[] = [];
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
      const [chunk] = data as [
        {
          content?: unknown;
          getType?: () => string;
          tool_call_chunks?: { name?: string }[];
          usage_metadata?: {
            input_tokens?: number;
            output_tokens?: number;
            input_token_details?: {
              cache_read?: number;
              cache_creation?: number;
            };
          };
        },
      ];
      if (chunk.getType?.() !== 'ai') continue;
      if (typeof chunk.content === 'string')
        process.stdout.write(chunk.content);
      for (const part of chunk.tool_call_chunks ?? []) {
        if (part.name) toolCalls.push(part.name);
      }
      const u = chunk.usage_metadata;
      if (u) {
        usage.calls++;
        usage.input += u.input_tokens ?? 0;
        usage.output += u.output_tokens ?? 0;
        usage.cacheRead += u.input_token_details?.cache_read ?? 0;
        usage.cacheWrite += u.input_token_details?.cache_creation ?? 0;
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
    const target = (request.args as { file_path?: string }).file_path;
    if (target) {
      const onDisk = existsSync(join(root, target));
      console.log(
        `${target} on disk before approval: ${onDisk ? 'yes' : 'no'}`,
      );
    }
    resume[pending.id] = await ask(request);
  }
  input = new Command({ resume });
}
terminal?.close();

console.log('\n--- S2 live report ---');
console.log(
  `node ${process.version} on ${process.platform}; ${provider} model ${model} at ${baseURL}`,
);
console.log(
  `approvals: ${autoApprove ? `automatic (ROCKY_S2_AUTO_APPROVE=${autoApprove})` : 'asked in the terminal'}`,
);
console.log(`elapsed ${((Date.now() - started) / 1000).toFixed(1)} s`);
console.log(
  'gate decisions:',
  gateLog.map((e) => `${e.tool}:${e.decision}`).join(', '),
);
console.log('tool calls:', toolCalls.join(', ') || 'none');
console.log(
  `usage: ${usage.calls} usage reports; input ${usage.input}, output ${usage.output}, cache read ${usage.cacheRead}, cache write ${usage.cacheWrite}`,
);
console.log('hosts contacted:', [...hosts].join(', ') || 'none');
console.log(`files in ${root}:`);
for (const name of readdirSync(root)) {
  console.log(`== ${name}\n${readFileSync(join(root, name), 'utf8')}`);
}

// Keep-alive sockets from the HTTP client would otherwise hold the process open.
process.exit(0);
