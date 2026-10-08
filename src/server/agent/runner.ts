// RockyAgentRunner: CopilotKit's AgentRunner backed by Rocky's local database instead of
// CopilotKit Intelligence. Run lifecycle follows the runtime's InMemoryAgentRunner (MIT);
// history is stored per run in SQLite so conversations survive restarts.
import {
  compactEvents,
  EventType,
  type AbstractAgent,
  type BaseEvent,
  type Message,
  type RunStartedEvent,
} from '@ag-ui/client';
import { finalizeRunEvents } from '@copilotkit/shared';
import {
  AgentRunner,
  type AgentRunnerConnectRequest,
  type AgentRunnerIsRunningRequest,
  type AgentRunnerRunRequest,
  type AgentRunnerStopRequest,
} from '@copilotkit/runtime/v2';
import { Observable, ReplaySubject } from 'rxjs';
import type { ThreadStore } from '../store/threads.ts';

interface LiveRun {
  runId: string;
  agent: AbstractAgent;
  subject: ReplaySubject<BaseEvent>;
  stopRequested: boolean;
}

const messageIdOf = (event: BaseEvent): string | undefined => {
  const id = (event as { messageId?: unknown }).messageId;
  return typeof id === 'string' ? id : undefined;
};

const firstUserText = (messages: Message[]): string => {
  const user = messages.find((m) => m.role === 'user');
  const content = user && 'content' in user ? user.content : undefined;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) =>
        'text' in part && typeof part.text === 'string' ? part.text : '',
      )
      .join(' ');
  }
  return '';
};

export class RockyAgentRunner extends AgentRunner {
  /** Lets the runtime serve thread list/messages/events/state from this runner. */
  override readonly ɵsupportsLocalThreadEndpoints = true;
  private readonly live = new Map<string, LiveRun>();
  private readonly store: ThreadStore;

  constructor(store: ThreadStore) {
    super();
    this.store = store;
  }

  run(request: AgentRunnerRunRequest): Observable<BaseEvent> {
    const { threadId, input, agent } = request;
    if (this.live.has(threadId)) throw new Error('Thread already running');
    const agentId = agent.agentId ?? 'default';
    this.store.ensureThread(threadId, agentId);
    const history = this.store.runs(threadId);
    const historicIds = new Set<string>();
    for (const run of history) {
      for (const event of run.events) {
        const id = messageIdOf(event);
        if (id) historicIds.add(id);
        if (event.type === EventType.RUN_STARTED) {
          for (const m of (event as RunStartedEvent).input?.messages ?? [])
            historicIds.add(m.id);
        }
      }
    }
    const newMessages = (input.messages ?? []).filter(
      (m) => !historicIds.has(m.id),
    );
    this.store.nameIfUnnamed(threadId, firstUserText(newMessages));
    this.store.startRun({
      id: input.runId,
      threadId,
      agentId,
      parentRunId: history.at(-1)?.id ?? null,
    });

    const subject = new ReplaySubject<BaseEvent>(Infinity);
    const live: LiveRun = {
      runId: input.runId,
      agent,
      subject,
      stopRequested: false,
    };
    this.live.set(threadId, live);
    const events: BaseEvent[] = [];

    const finalize = (error?: string) => {
      if (
        live.stopRequested &&
        !events.some((e) => e.type === EventType.RUN_STARTED)
      ) {
        const started = {
          type: EventType.RUN_STARTED,
          threadId,
          runId: input.runId,
          input: { ...input, messages: newMessages },
        } as BaseEvent;
        events.unshift(started);
        subject.next(started);
      }
      const appended = finalizeRunEvents(events, {
        stopRequested: live.stopRequested,
        ...((input as { protocolVersion?: string }).protocolVersion
          ? {
              protocolVersion: (input as { protocolVersion?: string })
                .protocolVersion,
            }
          : {}),
        ...(error !== undefined ? { interruptionMessage: error } : {}),
      } as Parameters<typeof finalizeRunEvents>[1]);
      for (const event of appended) {
        events.push(event);
        subject.next(event);
      }
      // An agent can report failure as a RUN_ERROR event instead of throwing.
      const reported = events.find((e) => e.type === EventType.RUN_ERROR) as
        { message?: string } | undefined;
      const failure = live.stopRequested
        ? 'stopped'
        : (error ?? reported?.message);
      this.store.finishRun(input.runId, {
        events: compactEvents(events),
        outcome: failure === undefined ? 'succeeded' : 'failed',
        ...(failure !== undefined ? { error: failure } : {}),
        messages: Array.isArray(agent.messages) ? [...agent.messages] : [],
      });
      this.live.delete(threadId);
      subject.complete();
    };

    void (async () => {
      try {
        await agent.runAgent(input, {
          onEvent: ({ event }) => {
            if (
              event.type === EventType.RUN_STARTED &&
              !(event as RunStartedEvent).input
            ) {
              (event as RunStartedEvent).input = {
                ...input,
                messages: newMessages,
              };
            }
            events.push(event);
            subject.next(event);
          },
        });
        finalize();
      } catch (error) {
        finalize(error instanceof Error ? error.message : String(error));
      }
    })();
    return subject.asObservable();
  }

  connect(request: AgentRunnerConnectRequest): Observable<BaseEvent> {
    const out = new ReplaySubject<BaseEvent>(Infinity);
    const history = compactEvents(
      this.store.runs(request.threadId).flatMap((run) => run.events),
    );
    const emitted = new Set<string>();
    for (const event of history) {
      out.next(event);
      const id = messageIdOf(event);
      if (id) emitted.add(id);
    }
    const live = this.live.get(request.threadId);
    if (!live) {
      out.complete();
      return out.asObservable();
    }
    live.subject.subscribe({
      next: (event) => {
        const id = messageIdOf(event);
        if (id && emitted.has(id)) return;
        out.next(event);
      },
      complete: () => out.complete(),
      error: (error: unknown) => out.error(error),
    });
    return out.asObservable();
  }

  isRunning(request: AgentRunnerIsRunningRequest): Promise<boolean> {
    return Promise.resolve(this.live.has(request.threadId));
  }

  stop(request: AgentRunnerStopRequest): Promise<boolean | undefined> {
    const live = this.live.get(request.threadId);
    if (!live || live.stopRequested) return Promise.resolve(false);
    if (request.runId !== undefined && request.runId !== live.runId)
      return Promise.resolve(false);
    live.stopRequested = true;
    live.agent.abortRun();
    return Promise.resolve(true);
  }

  // Local thread endpoints (list, messages, events, state) for the web UI.
  listThreads() {
    return this.store.threads().map((t) => ({
      id: t.id,
      name: t.name,
      agentId: t.agentId,
      organizationId: 'local',
      createdById: 'owner',
      archived: t.archived,
      createdAt: new Date(t.createdAt).toISOString(),
      updatedAt: new Date(t.updatedAt).toISOString(),
    }));
  }

  getThreadMessages(threadId: string): Message[] {
    return this.store.messages(threadId);
  }

  getThreadEvents(threadId: string): BaseEvent[] {
    return compactEvents(
      this.store.runs(threadId).flatMap((run) => run.events),
    );
  }

  getThreadState(threadId: string): Record<string, unknown> | null {
    const events = this.getThreadEvents(threadId);
    for (let i = events.length - 1; i >= 0; i--) {
      const event = events[i]!;
      if (event.type === EventType.STATE_SNAPSHOT) {
        const snapshot = (event as { snapshot?: unknown }).snapshot;
        return snapshot &&
          typeof snapshot === 'object' &&
          !Array.isArray(snapshot)
          ? { ...(snapshot as Record<string, unknown>) }
          : null;
      }
    }
    return null;
  }

  /** The runtime's "clear all threads" endpoint is a no-op: deleting history is explicit, per thread. */
  clearThreads(): void {}
}
