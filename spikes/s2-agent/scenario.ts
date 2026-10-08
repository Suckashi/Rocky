// S2 spike: Deep Agents in-process + real ChatOpenAI client + action gate + AG-UI mapping.
import { mkdtempSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { BaseEvent, Interrupt } from '@ag-ui/core';
import { EventSchemas } from '@ag-ui/core/schemas';
import { Command, MemorySaver } from '@langchain/langgraph';
import { ChatOpenAI } from '@langchain/openai';
import { todoListMiddleware, tool, type AgentMiddleware } from 'langchain';
import { z } from 'zod';
import {
  createDeepAgent,
  FilesystemBackend,
  GENERAL_PURPOSE_SUBAGENT,
} from 'deepagents';
import {
  startFakeOpenAI,
  type ChatRequestMessage,
  type ScriptedReply,
} from './fake-openai.ts';
import {
  createGateMiddleware,
  type ApprovalAnswer,
  type ApprovalRequest,
  type GateLogEntry,
} from './gate.ts';
import { AguiMapper } from './to-agui.ts';

function text(message: ChatRequestMessage): string {
  return typeof message.content === 'string'
    ? message.content
    : JSON.stringify(message.content ?? '');
}

export const ROCKY_BASE_PROMPT =
  'You are Rocky, a careful local engineering partner.';

export function script(messages: ChatRequestMessage[]): ScriptedReply {
  const users = messages
    .filter((m) => m.role === 'user')
    .map(text)
    .join('\n');
  const tools = messages.filter((m) => m.role === 'tool');
  const lastTool = tools.at(-1);
  if (users.includes('SUBTASK')) {
    if (tools.length === 0) {
      return {
        toolCalls: [
          {
            name: 'write_file',
            args: { file_path: '/sub.md', content: '子任務\n' },
          },
        ],
      };
    }
    return { text: '子任務完成。' };
  }
  if (users.includes('SCENARIO:rerun')) {
    if (tools.length === 0) {
      return {
        toolCalls: [
          { name: 'run_command', args: { argv: ['npm', 'test'] } },
          {
            name: 'write_file',
            args: { file_path: '/rerun.md', content: '重跑測試\n' },
          },
        ],
      };
    }
    return { text: '完成。' };
  }
  if (users.includes('SCENARIO:reject')) {
    if (tools.length === 0) {
      return {
        toolCalls: [
          {
            name: 'write_file',
            args: { file_path: '/x.md', content: '不該出現\n' },
          },
        ],
      };
    }
    return {
      text:
        lastTool && text(lastTool).includes('rejected')
          ? '收到，我換個做法。'
          : '意外狀況。',
    };
  }
  switch (tools.length) {
    case 0:
      return {
        text: '好，我先看看有哪些檔案。',
        toolCalls: [{ name: 'ls', args: { path: '/' } }],
      };
    case 1:
      return {
        toolCalls: [
          {
            name: 'write_file',
            args: {
              file_path: '/notes.md',
              content: '# 筆記\n\n第一行中文。\n',
            },
          },
          {
            name: 'write_file',
            args: { file_path: '/todo.md', content: '- 待辦\n' },
          },
        ],
      };
    case 3:
      return {
        toolCalls: [
          {
            name: 'task',
            args: {
              description: 'SUBTASK: 在 /sub.md 寫入一行「子任務」',
              subagent_type: 'general-purpose',
            },
          },
        ],
      };
    default:
      return { text: '全部完成：筆記、待辦和子任務都寫好了。' };
  }
}

export interface RunRecord {
  events: BaseEvent[];
  interrupts: Interrupt[];
}

export interface S2Report {
  runs: RunRecord[];
  rejectRuns: RunRecord[];
  gateLog: GateLogEntry[];
  writes: string[];
  files: Record<string, string | null>;
  rejectFileExists: boolean;
  commandRunsBeforeResume: number;
  commandRunsAfterResume: number;
  schemaErrors: string[];
  externalRequests: string[];
  systemPromptHead: string;
  systemPromptLength: number;
  toolNames: string[];
  modelRequests: number;
  requestRoles: string[];
}

export async function runS2(): Promise<S2Report> {
  const externalRequests: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.hostname !== '127.0.0.1') externalRequests.push(url.origin);
    return originalFetch(input, init);
  };
  const server = await startFakeOpenAI(script);
  try {
    const root = mkdtempSync(join(tmpdir(), 'rocky-s2-'));
    const writes: string[] = [];
    const filesystem = new FilesystemBackend({
      rootDir: root,
      virtualMode: true,
    });
    // Composition, not inheritance: count every real write that reaches disk.
    const backend = new Proxy(filesystem, {
      get(target, prop, receiver) {
        const value = Reflect.get(target, prop, receiver) as unknown;
        if (typeof value !== 'function') return value;
        if (prop === 'write' || prop === 'edit') {
          return (...args: unknown[]) => {
            writes.push(String(args[0]));
            return (value as (...a: unknown[]) => unknown).apply(target, args);
          };
        }
        return (value as (...a: unknown[]) => unknown).bind(target);
      },
    });
    const commandRuns: string[] = [];
    const runCommand = tool(
      ({ argv }) => {
        commandRuns.push(argv.join(' '));
        return 'exit 0';
      },
      {
        name: 'run_command',
        description: 'Run a command given as an argv array.',
        schema: z.object({ argv: z.array(z.string()) }),
      },
    );
    const gateLog: GateLogEntry[] = [];
    const gate = createGateMiddleware(gateLog);
    const agent = createDeepAgent({
      model: new ChatOpenAI({
        model: 'fake',
        apiKey: 'unused',
        configuration: { baseURL: server.baseURL },
        streaming: true,
      }),
      backend,
      systemPrompt: ROCKY_BASE_PROMPT,
      tools: [runCommand],
      // Only Codex profiles add the todo list by default; Rocky adds it for every model.
      // Cast: langchain's todo middleware types fail under exactOptionalPropertyTypes.
      middleware: [todoListMiddleware() as unknown as AgentMiddleware, gate],
      // The parent's middleware does not reach the built-in general-purpose
      // subagent, so it is redefined here with the gate attached.
      subagents: [{ ...GENERAL_PURPOSE_SUBAGENT, middleware: [gate] }],
      checkpointer: new MemorySaver(),
    });

    async function run(
      threadId: string,
      input: Parameters<typeof agent.stream>[0],
      runId: string,
    ): Promise<RunRecord> {
      const mapper = new AguiMapper(threadId, runId);
      const stream = await agent.stream(input, {
        configurable: { thread_id: threadId },
        streamMode: ['messages', 'updates'],
        subgraphs: true,
      });
      for await (const item of stream)
        mapper.push(item as [string[], string, unknown]);
      return { events: mapper.finish(), interrupts: mapper.pendingInterrupts };
    }

    function answer(
      interrupts: Interrupt[],
      decision: ApprovalAnswer['decision'],
    ) {
      const resume: Record<string, ApprovalAnswer> = {};
      for (const pending of interrupts) {
        const request = (pending.metadata as { request: ApprovalRequest })
          .request;
        resume[pending.id] = {
          decision,
          hash: request.hash,
          reason: '測試拒絕',
        };
      }
      return new Command({ resume });
    }

    const runs: RunRecord[] = [];
    let record = await run(
      'main',
      { messages: [{ role: 'user', content: '幫我整理筆記' }] },
      'r1',
    );
    runs.push(record);
    for (let step = 2; record.interrupts.length > 0 && step < 10; step++) {
      record = await run(
        'main',
        answer(record.interrupts, 'allow'),
        `r${step}`,
      );
      runs.push(record);
    }

    const rejectRuns: RunRecord[] = [];
    let rejected = await run(
      'reject',
      { messages: [{ role: 'user', content: 'SCENARIO:reject' }] },
      'x1',
    );
    rejectRuns.push(rejected);
    if (rejected.interrupts.length > 0) {
      rejected = await run(
        'reject',
        answer(rejected.interrupts, 'reject'),
        'x2',
      );
      rejectRuns.push(rejected);
    }

    const rerunRuns: RunRecord[] = [];
    let rerun = await run(
      'rerun',
      { messages: [{ role: 'user', content: 'SCENARIO:rerun' }] },
      'y1',
    );
    rerunRuns.push(rerun);
    const commandRunsBeforeResume = commandRuns.length;
    if (rerun.interrupts.length > 0) {
      rerun = await run('rerun', answer(rerun.interrupts, 'allow'), 'y2');
      rerunRuns.push(rerun);
    }

    const schemaErrors: string[] = [];
    for (const event of [...runs, ...rejectRuns, ...rerunRuns].flatMap(
      (r) => r.events,
    )) {
      const result = EventSchemas.safeParse(event);
      if (!result.success)
        schemaErrors.push(`${event.type}: ${result.error.message}`);
    }
    const read = (name: string) =>
      existsSync(join(root, name))
        ? readFileSync(join(root, name), 'utf8')
        : null;
    const firstRequest = server.requests[0];
    const system = firstRequest?.messages.find((m) => m.role === 'system');
    const systemText = system ? text(system) : '';
    return {
      runs,
      rejectRuns,
      gateLog,
      writes,
      files: {
        'notes.md': read('notes.md'),
        'todo.md': read('todo.md'),
        'sub.md': read('sub.md'),
      },
      rejectFileExists: existsSync(join(root, 'x.md')),
      commandRunsBeforeResume,
      commandRunsAfterResume: commandRuns.length,
      schemaErrors,
      externalRequests,
      systemPromptHead: systemText.slice(0, 400),
      systemPromptLength: systemText.length,
      toolNames: firstRequest?.toolNames ?? [],
      modelRequests: server.requests.length,
      requestRoles: server.requests.map((r) =>
        r.messages.map((m) => m.role).join(','),
      ),
    };
  } finally {
    globalThis.fetch = originalFetch;
    await server.close();
  }
}

if (import.meta.main) {
  const report = await runS2();
  const summary = {
    ...report,
    runs: report.runs.map((r) => ({
      events: r.events.map((e) => {
        const x = e as unknown as Record<string, string>;
        return [
          e.type,
          x['toolCallId'] ?? x['messageId'] ?? x['subagentRunId'] ?? '',
          x['subagentRunId'] ? 'sub' : '',
        ]
          .filter(Boolean)
          .join(' ');
      }),
      interrupts: r.interrupts.map(
        (i) => (i.metadata as { request: ApprovalRequest }).request.tool,
      ),
    })),
    rejectRuns: report.rejectRuns.map((r) => r.events.map((e) => e.type)),
  };
  console.log(JSON.stringify(summary, null, 2));
}
