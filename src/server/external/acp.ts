// Rocky's side of ACP: one external agent process; every permission request goes to
// Rocky's decision, and only allow_once or reject_once is ever sent back (never "always").
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { Readable, Writable } from 'node:stream';
import {
  ClientSideConnection,
  ndJsonStream,
  PROTOCOL_VERSION,
  type PromptResponse,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
  type SessionNotification,
} from '@agentclientprotocol/sdk';
import { endGroup, killTree } from '../effects/execute.ts';

export type PermissionDecision = 'allow' | 'reject';

export interface AcpHandlers {
  decide: (request: RequestPermissionRequest) => Promise<PermissionDecision>;
  update: (notification: SessionNotification) => void;
}

export class AcpAgent {
  readonly connection: ClientSideConnection;
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly exited: Promise<unknown>;
  /** Rejects when the process fails to start or exits: requests waiting on it end too. */
  private readonly ended: Promise<never>;
  private readonly pending = new Map<
    string,
    (response: RequestPermissionResponse) => void
  >();
  private stderrTail = '';

  /** `group`: the child leads its own process group (spawned detached). */
  constructor(
    child: ChildProcessWithoutNullStreams,
    handlers: AcpHandlers,
    { group = false }: { group?: boolean } = {},
  ) {
    this.child = child;
    this.exited = new Promise((resolve) => {
      child.once('error', resolve);
      // What it left running in its group ends with it, right away (before its number
      // can be given to another process).
      child.once('exit', (code) => {
        if (group) endGroup(child);
        resolve(code);
      });
    });
    // A failed spawn (ENOENT, EACCES) is an 'error' event; unheard, it would end Rocky.
    // Requests end once the process is gone and its last output has been read.
    this.ended = new Promise<never>((_, reject) => {
      child.once('error', reject);
      child.once('close', (code, signal) =>
        reject(new Error(`OpenCode exited (${signal ?? code})`)),
      );
    });
    this.ended.catch(() => undefined);
    // Writing to a process that is gone (EPIPE) fails the request, not Rocky.
    child.stdin.on('error', () => undefined);
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (text: string) => {
      this.stderrTail = (this.stderrTail + text).slice(-8000);
    });
    const stream = ndJsonStream(
      Writable.toWeb(child.stdin) as WritableStream<Uint8Array>,
      Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>,
    );
    this.connection = new ClientSideConnection(
      () => ({
        requestPermission: (request) => this.onPermission(request, handlers),
        sessionUpdate: async (notification) => handlers.update(notification),
      }),
      stream,
    );
  }

  get stderr(): string {
    return this.stderrTail;
  }

  private onPermission(
    request: RequestPermissionRequest,
    handlers: AcpHandlers,
  ): Promise<RequestPermissionResponse> {
    const id = request.toolCall.toolCallId;
    return new Promise((resolve) => {
      // session/cancel must answer every open request with "cancelled".
      this.pending.set(id, (response) => {
        this.pending.delete(id);
        resolve(response);
      });
      void handlers
        .decide(request)
        .catch((): PermissionDecision => 'reject')
        .then((decision) => {
          const answer = this.pending.get(id);
          if (!answer) return; // already cancelled
          const wanted = decision === 'allow' ? 'allow_once' : 'reject_once';
          const option = request.options.find((o) => o.kind === wanted);
          answer(
            option
              ? { outcome: { outcome: 'selected', optionId: option.optionId } }
              : { outcome: { outcome: 'cancelled' } },
          );
        });
    });
  }

  /** A request to the agent, or the reason it can no longer answer. */
  private request<T>(sent: Promise<T>): Promise<T> {
    return Promise.race([sent, this.ended]);
  }

  async initialize(): Promise<void> {
    await this.request(
      this.connection.initialize({
        protocolVersion: PROTOCOL_VERSION,
        clientCapabilities: {
          fs: { readTextFile: false, writeTextFile: false },
          terminal: false,
        },
        clientInfo: { name: 'rocky', version: '0.1.0' },
      }),
    );
  }

  async newSession(cwd: string): Promise<string> {
    return (
      await this.request(this.connection.newSession({ cwd, mcpServers: [] }))
    ).sessionId;
  }

  prompt(sessionId: string, text: string): Promise<PromptResponse> {
    return this.request(
      this.connection.prompt({ sessionId, prompt: [{ type: 'text', text }] }),
    );
  }

  async cancel(sessionId: string): Promise<void> {
    await this.connection.cancel({ sessionId }).catch(() => undefined);
    for (const answer of [...this.pending.values()]) {
      answer({ outcome: { outcome: 'cancelled' } });
    }
  }

  /**
   * Ends the agent with deadlines: close stdin, then SIGTERM, then end the whole tree. On
   * Windows a plain kill ends only OpenCode itself, so the second step ends the tree.
   */
  async close(): Promise<string> {
    type Step = [string, () => void, number];
    const terminate: Step[] =
      process.platform === 'win32'
        ? []
        : [['terminated', () => this.child.kill(), 3000]];
    const steps: Step[] = [
      ['stdin-closed', () => this.child.stdin.end(), 2000],
      ...terminate,
      ['killed', () => killTree(this.child), 5000],
    ];
    let result = 'still-running';
    for (const [label, act, wait] of steps) {
      if (await this.gone()) {
        result = 'exited';
        break;
      }
      act();
      const done = await Promise.race([
        this.exited.then(() => true),
        new Promise<false>((r) => setTimeout(() => r(false), wait)),
      ]);
      if (done) {
        result = label;
        break;
      }
    }
    return result;
  }

  /** True once the process has exited or never started. */
  private async gone(): Promise<boolean> {
    if (this.child.exitCode !== null || this.child.signalCode !== null)
      return true;
    return Promise.race([
      this.exited.then(() => true),
      new Promise<false>((r) => setImmediate(() => r(false))),
    ]);
  }
}
