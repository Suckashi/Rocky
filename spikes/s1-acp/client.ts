// Rocky's side of ACP: one external agent process, every permission request routed
// through Rocky's decision, and only allow_once / reject_once ever sent back.
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { createHash } from 'node:crypto';
import { Readable, Writable } from 'node:stream';
import {
  ClientSideConnection,
  ndJsonStream,
  PROTOCOL_VERSION,
  type InitializeResponse,
  type PromptResponse,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
  type SessionNotification,
} from '@agentclientprotocol/sdk';

export interface PermissionAsk {
  sessionId: string;
  toolCallId: string;
  kind: string;
  title: string;
  /** Diff entries or the raw command, exactly as the agent will apply them. */
  content: unknown;
  rawInput: unknown;
  hash: string;
  offered: string[];
}

export type Decision = 'allow' | 'reject';
export type Decide = (ask: PermissionAsk) => Promise<Decision>;

export interface PermissionReceipt {
  toolCallId: string;
  kind: string;
  hash: string;
  outcome: 'allow_once' | 'reject_once' | 'cancelled';
  content: unknown;
}

/** Binds an approval to the exact content. The cwd comes from Rocky: OpenCode's bash request omits it. */
export function permissionHash(
  request: RequestPermissionRequest,
  cwd: string,
): string {
  const { kind, content, rawInput } = request.toolCall;
  return createHash('sha256')
    .update(JSON.stringify({ kind, content, rawInput, cwd }))
    .digest('hex');
}

export class AcpAgent {
  readonly updates: SessionNotification[] = [];
  readonly receipts: PermissionReceipt[] = [];
  readonly stderr: string[] = [];
  readonly connection: ClientSideConnection;
  private pending = new Map<string, (r: RequestPermissionResponse) => void>();
  private cwds = new Map<string, string>();
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly exited: Promise<unknown>;

  constructor(child: ChildProcessWithoutNullStreams, decide: Decide) {
    this.child = child;
    this.exited = new Promise((resolve) => child.once('exit', resolve));
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (text: string) => this.stderr.push(text));
    const stream = ndJsonStream(
      Writable.toWeb(child.stdin) as WritableStream<Uint8Array>,
      Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>,
    );
    this.connection = new ClientSideConnection(
      () => ({
        requestPermission: (request) => this.onPermission(request, decide),
        sessionUpdate: (notification) => {
          this.updates.push(notification);
        },
      }),
      stream,
    );
  }

  private onPermission(
    request: RequestPermissionRequest,
    decide: Decide,
  ): Promise<RequestPermissionResponse> {
    const { toolCall, options, sessionId } = request;
    const ask: PermissionAsk = {
      sessionId,
      toolCallId: toolCall.toolCallId,
      kind: toolCall.kind ?? 'other',
      title: toolCall.title ?? '',
      content: toolCall.content ?? null,
      rawInput: toolCall.rawInput ?? null,
      hash: permissionHash(request, this.cwds.get(sessionId) ?? ''),
      offered: options.map((option) => option.kind),
    };
    const record = (outcome: PermissionReceipt['outcome']) =>
      this.receipts.push({
        toolCallId: ask.toolCallId,
        kind: ask.kind,
        hash: ask.hash,
        outcome,
        content: ask.content,
      });
    return new Promise((resolve) => {
      // session/cancel must answer every open request with "cancelled".
      this.pending.set(ask.toolCallId, (response) => {
        this.pending.delete(ask.toolCallId);
        if (response.outcome.outcome === 'cancelled') record('cancelled');
        resolve(response);
      });
      void decide(ask).then((decision) => {
        const answer = this.pending.get(ask.toolCallId);
        if (!answer) return; // already cancelled
        // Never allow_always: standing rules live in Rocky, not in the agent.
        const wanted = decision === 'allow' ? 'allow_once' : 'reject_once';
        const option = options.find((o) => o.kind === wanted);
        if (!option) {
          answer({ outcome: { outcome: 'cancelled' } });
          return;
        }
        record(wanted);
        answer({ outcome: { outcome: 'selected', optionId: option.optionId } });
      });
    });
  }

  initialize(): Promise<InitializeResponse> {
    return this.connection.initialize({
      protocolVersion: PROTOCOL_VERSION,
      clientCapabilities: {
        fs: { readTextFile: false, writeTextFile: false },
        terminal: false,
      },
      clientInfo: { name: 'rocky-s1', version: '0.0.0' },
    });
  }

  async newSession(cwd: string): Promise<string> {
    const session = await this.connection.newSession({ cwd, mcpServers: [] });
    this.cwds.set(session.sessionId, cwd);
    return session.sessionId;
  }

  async loadSession(sessionId: string, cwd: string): Promise<void> {
    this.cwds.set(sessionId, cwd);
    await this.connection.loadSession({ sessionId, cwd, mcpServers: [] });
  }

  prompt(sessionId: string, text: string): Promise<PromptResponse> {
    return this.connection.prompt({
      sessionId,
      prompt: [{ type: 'text', text }],
    });
  }

  async cancel(sessionId: string): Promise<void> {
    await this.connection.cancel({ sessionId });
    for (const answer of [...this.pending.values()]) {
      answer({ outcome: { outcome: 'cancelled' } });
    }
  }

  get pendingPermissions(): number {
    return this.pending.size;
  }

  /** Ends the agent with a deadline: close stdin, then SIGTERM, then a hard kill. */
  async close(): Promise<string> {
    const steps: [string, () => void, number][] = [
      ['stdin-closed', () => this.child.stdin.end(), 2000],
      ['terminated', () => this.child.kill(), 3000],
      ['killed', () => this.child.kill('SIGKILL'), 5000],
    ];
    for (const [label, act, wait] of steps) {
      if (this.child.exitCode !== null || this.child.signalCode !== null) break;
      act();
      const done = await Promise.race([
        this.exited.then(() => true),
        new Promise<false>((resolve) => setTimeout(() => resolve(false), wait)),
      ]);
      if (done) return label;
    }
    return this.child.exitCode !== null || this.child.signalCode !== null
      ? 'exited'
      : 'still-running';
  }
}
