// Maps a Deep Agents stream (streamMode messages+updates, subgraphs) to AG-UI events,
// emitting each event as soon as it is known. Proven in the S2 spike (ADR 0001).
import { EventType, type BaseEvent, type TokenUsage } from '@ag-ui/core';

interface ChunkLike {
  id?: string;
  content?: unknown;
  tool_call_chunks?: {
    id?: string;
    name?: string;
    args?: string;
    index?: number;
  }[];
  usage_metadata?: {
    input_tokens?: number;
    output_tokens?: number;
    input_token_details?: { cache_read?: number };
  };
  tool_call_id?: string;
  name?: string;
  getType?: () => string;
}

type StreamItem = [string[], string, unknown];

export class AguiMapper {
  readonly events: BaseEvent[] = [];
  private readonly onEvent: (event: BaseEvent) => void;
  readonly usage: TokenUsage[] = [];
  private openText = new Set<string>();
  private toolIdByIndex = new Map<string, string>();
  private openTools = new Map<string, string>();
  private seenResults = new Set<string>();
  private subagents = new Map<string, string>();
  private lastTaskCallId: string | undefined;

  private readonly threadId: string;
  private readonly runId: string;

  constructor(
    threadId: string,
    runId: string,
    onEvent: (event: BaseEvent) => void = () => {},
  ) {
    this.threadId = threadId;
    this.runId = runId;
    this.onEvent = onEvent;
    this.emit({ type: EventType.RUN_STARTED, threadId, runId });
  }

  private emit(event: BaseEvent & Record<string, unknown>): void {
    this.events.push(event);
    this.onEvent(event);
  }

  private subagentFor(ns: string[]): string | undefined {
    if (ns.length < 2) return undefined;
    const key = ns.slice(0, -1).join('|');
    let id = this.subagents.get(key);
    if (!id) {
      id = `sub-${this.subagents.size + 1}`;
      this.subagents.set(key, id);
      this.emit({
        type: EventType.SUBAGENT_STARTED,
        subagentRunId: id,
        name: 'general-purpose',
        ...(this.lastTaskCallId
          ? { parentToolCallId: this.lastTaskCallId }
          : {}),
      });
    }
    return id;
  }

  private closeText(messageId: string): void {
    if (this.openText.delete(messageId)) {
      this.emit({ type: EventType.TEXT_MESSAGE_END, messageId });
    }
  }

  push([ns, mode, data]: StreamItem): void {
    if (mode === 'messages') {
      const [chunk] = data as [ChunkLike];
      const type = chunk.getType?.();
      const sub = this.subagentFor(ns);
      const scope = sub ? { subagentRunId: sub } : {};
      if (type === 'tool') this.toolResult(chunk, scope);
      else if (type === 'ai') this.aiChunk(chunk, scope);
      return;
    }
    if (mode === 'updates') {
      const update = data as Record<string, unknown>;
      const model = update['model_request'] as
        { messages?: ChunkLike[] } | undefined;
      for (const message of model?.messages ?? []) this.finishMessage(message);
      const tools = update['tools'] as { messages?: ChunkLike[] } | undefined;
      const sub = this.subagentFor(ns.length ? [...ns, 'tools'] : ns);
      for (const message of tools?.messages ?? []) {
        if (message.getType?.() === 'tool')
          this.toolResult(message, sub ? { subagentRunId: sub } : {});
      }
    }
  }

  private aiChunk(chunk: ChunkLike, scope: object): void {
    const messageId = chunk.id ?? 'unknown';
    if (typeof chunk.content === 'string' && chunk.content !== '') {
      if (!this.openText.has(messageId)) {
        this.openText.add(messageId);
        this.emit({
          type: EventType.TEXT_MESSAGE_START,
          messageId,
          role: 'assistant',
          ...scope,
        });
      }
      this.emit({
        type: EventType.TEXT_MESSAGE_CONTENT,
        messageId,
        delta: chunk.content,
        ...scope,
      });
    }
    for (const part of chunk.tool_call_chunks ?? []) {
      const key = `${messageId}:${part.index ?? 0}`;
      let toolCallId = this.toolIdByIndex.get(key);
      if (!toolCallId && part.id) {
        this.closeText(messageId);
        toolCallId = part.id;
        this.toolIdByIndex.set(key, toolCallId);
        this.openTools.set(toolCallId, messageId);
        if (part.name === 'task') this.lastTaskCallId = toolCallId;
        this.emit({
          type: EventType.TOOL_CALL_START,
          toolCallId,
          toolCallName: part.name ?? 'unknown',
          parentMessageId: messageId,
          ...scope,
        });
      }
      if (toolCallId && part.args) {
        this.emit({
          type: EventType.TOOL_CALL_ARGS,
          toolCallId,
          delta: part.args,
          ...scope,
        });
      }
    }
    const usage = chunk.usage_metadata;
    if (usage) {
      this.usage.push({
        provider: 'openai-compatible',
        inputTokens: usage.input_tokens ?? 0,
        outputTokens: usage.output_tokens ?? 0,
        cachedInputTokens: usage.input_token_details?.cache_read ?? 0,
      });
    }
  }

  private finishMessage(message: ChunkLike): void {
    const messageId = message.id ?? 'unknown';
    this.closeText(messageId);
    for (const [toolCallId, parent] of this.openTools) {
      if (parent === messageId) {
        this.openTools.delete(toolCallId);
        this.emit({ type: EventType.TOOL_CALL_END, toolCallId });
      }
    }
  }

  private toolResult(message: ChunkLike, scope: object): void {
    const toolCallId = message.tool_call_id ?? 'unknown';
    if (this.seenResults.has(toolCallId)) return;
    this.seenResults.add(toolCallId);
    if (this.openTools.delete(toolCallId)) {
      this.emit({ type: EventType.TOOL_CALL_END, toolCallId });
    }
    this.emit({
      type: EventType.TOOL_CALL_RESULT,
      messageId: message.id ?? `${toolCallId}-result`,
      toolCallId,
      role: 'tool',
      content:
        typeof message.content === 'string'
          ? message.content
          : JSON.stringify(message.content),
      ...scope,
    });
    if (message.name === 'task' || toolCallId === this.lastTaskCallId) {
      for (const [key, subagentRunId] of this.subagents) {
        this.subagents.delete(key);
        this.emit({
          type: EventType.SUBAGENT_FINISHED,
          subagentRunId,
          outcome: { type: 'success' },
        });
      }
    }
  }

  finish(): BaseEvent[] {
    for (const messageId of [...this.openText]) this.closeText(messageId);
    // Approvals wait inside the tool call (gate.ts), so a run never ends on a LangGraph
    // interrupt; a finished run is a success.
    this.emit({
      type: EventType.RUN_FINISHED,
      threadId: this.threadId,
      runId: this.runId,
      outcome: { type: 'success' },
      ...(this.usage.length ? { usage: this.usage } : {}),
    });
    return this.events;
  }
}
