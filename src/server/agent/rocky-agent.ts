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
import { createDeepAgent, registerHarnessProfile } from 'deepagents';
import { todoListMiddleware, type AgentMiddleware } from 'langchain';
import { Observable } from 'rxjs';
import type { SettingsStore } from '../store/settings.ts';
import { rockyPrompt } from './prompt.ts';
import { AguiMapper } from './to-agui.ts';

// Hide the virtual filesystem and subagent tools until M2 wires them through the gate.
// Exclusions shape what the model sees; they are not a security boundary.
registerHarnessProfile('openai', {
  excludedTools: [
    'ls',
    'read_file',
    'write_file',
    'edit_file',
    'glob',
    'grep',
    'execute',
    'task',
  ],
});

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

/** AG-UI messages from the browser to LangChain messages for the model. */
export function toLangChain(messages: Message[]): BaseMessage[] {
  const out: BaseMessage[] = [];
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
              args: JSON.parse(call.function.arguments || '{}') as Record<
                string,
                unknown
              >,
              type: 'tool_call' as const,
            })),
          }),
        );
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
      // The mapper emits RUN_STARTED first, so even a configuration error is a well-formed run.
      const mapper = new AguiMapper(input.threadId, input.runId, (event) =>
        subscriber.next(event),
      );
      void (async () => {
        const settings = this.deps.settings;
        const model = settings.model();
        if (!model) throw new ModelNotConfiguredError();
        const agent = createDeepAgent({
          model: new ChatOpenAI({
            model: model.model,
            apiKey: settings.apiKey() ?? 'not-needed',
            configuration: { baseURL: model.baseURL },
            streaming: true,
          }),
          systemPrompt: rockyPrompt(settings.locale()),
          // Cast: langchain's todo middleware types fail under exactOptionalPropertyTypes (ADR 0001).
          middleware: [todoListMiddleware() as unknown as AgentMiddleware],
        });
        const stream = await agent.stream(
          { messages: toLangChain(input.messages) },
          {
            streamMode: ['messages', 'updates'],
            subgraphs: true,
            signal: controller.signal,
          },
        );
        for await (const item of stream) {
          mapper.push(item as [string[], string, unknown]);
        }
        mapper.finish();
        subscriber.complete();
      })().catch((error: unknown) => {
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
