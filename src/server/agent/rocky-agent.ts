// RockyAgent: an AG-UI agent that runs Deep Agents in this process and streams AG-UI events.
// M1 is chat only: no file or command tools yet (they arrive with the action gate in M2).
import {
  AbstractAgent,
  EventType,
  type BaseEvent,
  type Message,
  type RunAgentInput,
} from '@ag-ui/client';
import {
  AIMessage,
  HumanMessage,
  SystemMessage,
  ToolMessage,
  type BaseMessage,
} from '@langchain/core/messages';
import { ChatOpenAI } from '@langchain/openai';
import {
  createDeepAgent,
  GENERAL_PURPOSE_SUBAGENT,
  registerHarnessProfile,
} from 'deepagents';
import { todoListMiddleware, type AgentMiddleware } from 'langchain';
import { Observable } from 'rxjs';
import type { Executor } from '../effects/execute.ts';
import type { ReceiptStore } from '../effects/receipts.ts';
import type { JobRunner } from '../jobs/runner.ts';
import type { Gate } from '../effects/gate.ts';
import type { SettingsStore } from '../store/settings.ts';
import { createRockyBackend } from './backend.ts';
import { createGateMiddleware, type GateRun } from './gate-middleware.ts';
import { createDelegateTool } from './delegate.ts';
import { createDocumentTools } from './documents.ts';
import { createPlanTool } from './plan.ts';
import { createMemoryTools, memoryPrompt } from './memory.ts';
import type { MemoryStore } from '../memory/store.ts';
import type { SkillStore } from '../skills/store.ts';
import { createSkillTool, skillsPrompt } from './skills.ts';
import { createMcpTools } from './mcp.ts';
import type { McpManager } from '../mcp/manager.ts';
import { createRunCommandTool } from './run-command.ts';
import { projectInstructions, rockyPrompt } from './prompt.ts';
import { AguiMapper } from './to-agui.ts';

// Deep Agents' shell tool takes a shell string with no approval point; Rocky has run_command.
// Exclusions shape what the model sees; the gate middleware is the actual boundary.
registerHarnessProfile('openai', { excludedTools: ['execute', 'delete'] });

export class ModelNotConfiguredError extends Error {
  constructor() {
    super('model-not-configured');
  }
}

function textOf(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part: { type?: string; text?: string }) =>
        part.type === 'text' ? (part.text ?? '') : '',
      )
      .join('');
  }
  return '';
}

export const INTERRUPTED_TOOL_RESULT =
  'This tool call was interrupted before it returned; its outcome is unknown. Check before repeating it.';

/** Tool-call arguments from history. A stream cut off mid-call leaves broken JSON; that call
 * then gets an "interrupted" result below, so empty arguments are enough to keep it valid. */
function toolArgs(text: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(text || '{}');
    return value !== null && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/** AG-UI messages from the browser to LangChain messages for the model. */
export function toLangChain(messages: Message[]): BaseMessage[] {
  const out: BaseMessage[] = [];
  const answered = new Set(
    messages.flatMap((m) => (m.role === 'tool' ? [m.toolCallId] : [])),
  );
  for (const message of messages) {
    switch (message.role) {
      case 'user':
        out.push(
          new HumanMessage({
            id: message.id,
            content: textOf(message.content),
          }),
        );
        break;
      case 'assistant':
        out.push(
          new AIMessage({
            id: message.id,
            content: textOf(message.content),
            tool_calls: (message.toolCalls ?? []).map((call) => ({
              id: call.id,
              name: call.function.name,
              args: toolArgs(call.function.arguments),
              type: 'tool_call' as const,
            })),
          }),
        );
        // A turn stopped mid-tool leaves calls without results; models reject that history.
        for (const call of message.toolCalls ?? []) {
          if (!answered.has(call.id))
            out.push(
              new ToolMessage({
                tool_call_id: call.id,
                status: 'error',
                content: INTERRUPTED_TOOL_RESULT,
              }),
            );
        }
        break;
      case 'tool':
        out.push(
          new ToolMessage({
            id: message.id,
            tool_call_id: message.toolCallId,
            content: textOf(message.content),
          }),
        );
        break;
      case 'system':
      case 'developer':
        out.push(
          new SystemMessage({
            id: message.id,
            content: textOf(message.content),
          }),
        );
        break;
      default:
        break;
    }
  }
  return out;
}

export interface RockyAgentDeps {
  settings: SettingsStore;
  gate: Gate;
  executor: Executor;
  receipts: ReceiptStore;
  memory?: MemoryStore;
  skills?: SkillStore;
  mcp?: McpManager;
  jobs?: JobRunner;
}

export class RockyAgent extends AbstractAgent {
  private readonly deps: RockyAgentDeps;
  private controller: AbortController | undefined;

  constructor(deps: RockyAgentDeps, agentId = 'rocky') {
    super({ agentId, description: 'Rocky' });
    this.deps = deps;
  }

  override clone(): RockyAgent {
    const copy = new RockyAgent(this.deps, this.agentId ?? 'rocky');
    copy.setMessages(structuredClone(this.messages));
    copy.setState(structuredClone(this.state));
    copy.threadId = this.threadId;
    return copy;
  }

  override abortRun(): void {
    this.controller?.abort();
  }

  override run(input: RunAgentInput): Observable<BaseEvent> {
    return new Observable<BaseEvent>((subscriber) => {
      const controller = new AbortController();
      this.controller = controller;
      const { settings, gate, executor, receipts, memory, skills, mcp, jobs } =
        this.deps;
      // The mapper emits RUN_STARTED first, so even a configuration error is a well-formed run.
      const mapper = new AguiMapper(input.threadId, input.runId, (event) =>
        subscriber.next(event),
      );
      // Pending approvals reach the UI as standard state snapshots (no custom events).
      const publishState = () =>
        subscriber.next({
          type: EventType.STATE_SNAPSHOT,
          snapshot: {
            mode: gate.mode(input.threadId),
            pendingApprovals: gate.pending(input.threadId),
          },
        } as BaseEvent);
      const unsubscribe = gate.subscribe(input.threadId, publishState);
      void (async () => {
        const model = settings.model();
        if (!model) throw new ModelNotConfiguredError();
        const projectRoot = settings.project();
        // MCP servers connect once and stay connected; a server that fails is skipped.
        const servers = settings.mcpServers();
        const mcpTools =
          mcp && servers.length
            ? createMcpTools(mcp, await mcp.refresh(servers), controller.signal)
            : undefined;
        const run: GateRun = {
          gate,
          receipts,
          projectRoot,
          ...(memory ? { memory } : {}),
          ...(mcpTools
            ? { mcp: { map: mcpTools.map, policies: settings.toolPolicies() } }
            : {}),
          threadId: input.threadId,
          runId: input.runId,
          signal: controller.signal,
        };
        const agent = createDeepAgent({
          model: new ChatOpenAI({
            model: model.model,
            apiKey: settings.apiKey() ?? 'not-needed',
            configuration: { baseURL: model.baseURL },
            streaming: true,
            // Model calls change nothing outside, so retrying a 429 or network error is safe.
            maxRetries: 3,
          }),
          systemPrompt: [
            rockyPrompt(settings.locale(), projectRoot),
            ...(projectInstructions(projectRoot)
              ? [projectInstructions(projectRoot)!]
              : []),
            ...(memory ? [memoryPrompt(memory)] : []),
            ...(skills && skillsPrompt(skills) ? [skillsPrompt(skills)!] : []),
          ].join('\n\n'),
          ...(projectRoot
            ? { backend: createRockyBackend(projectRoot, executor) }
            : {}),
          tools: [
            ...(memory ? createMemoryTools(memory, executor) : []),
            ...(mcpTools?.tools ?? []),
            ...(skills && skills.list().length
              ? [createSkillTool(skills)]
              : []),
            ...(projectRoot
              ? [
                  createPlanTool(),
                  createRunCommandTool(projectRoot, executor),
                  ...createDocumentTools(projectRoot, executor),
                  ...(jobs
                    ? [
                        createDelegateTool(jobs, {
                          threadId: input.threadId,
                          runId: input.runId,
                          signal: controller.signal,
                        }),
                      ]
                    : []),
                ]
              : []),
          ],
          // Cast: langchain's todo middleware types fail under exactOptionalPropertyTypes (ADR 0001).
          middleware: [
            todoListMiddleware() as unknown as AgentMiddleware,
            createGateMiddleware(run, 'rocky'),
          ],
          // The built-in subagent does not inherit middleware (ADR 0001, finding 1): gate it explicitly.
          subagents: [
            {
              ...GENERAL_PURPOSE_SUBAGENT,
              // Read-only: it researches and reports; Rocky makes the changes (enforced by the gate middleware).
              description:
                'A read-only helper for research in the project: it searches and reads files (and documents) and reports what it found. It cannot change files, run commands or delegate.',
              middleware: [createGateMiddleware(run, 'subagent')],
            },
          ],
        });
        publishState();
        const stream = await agent.stream(
          { messages: toLangChain(input.messages) },
          {
            streamMode: ['messages', 'updates'],
            subgraphs: true,
            signal: controller.signal,
            recursionLimit: 100,
          },
        );
        for await (const item of stream) {
          mapper.push(item as [string[], string, unknown]);
        }
        mapper.finish();
        unsubscribe();
        subscriber.complete();
      })().catch((error: unknown) => {
        unsubscribe();
        if (controller.signal.aborted) {
          subscriber.error(new Error('stopped'));
          return;
        }
        subscriber.next({
          type: EventType.RUN_ERROR,
          message: error instanceof Error ? error.message : String(error),
          code:
            error instanceof ModelNotConfiguredError
              ? 'model-not-configured'
              : 'model-error',
        } as BaseEvent);
        subscriber.complete();
      });
      return () => controller.abort();
    });
  }
}
