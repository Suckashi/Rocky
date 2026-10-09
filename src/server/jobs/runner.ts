// Runs one job: a worktree of the project, OpenCode over ACP inside it, every permission
// request through Rocky's gate, then Rocky's own verification (diff against what it
// approved, and the project's tests). Nothing reaches the project until the user applies it.
import { existsSync, mkdirSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import type { SessionNotification } from '@agentclientprotocol/sdk';
import { contentHash } from '../effects/hash.ts';
import type { Executor } from '../effects/execute.ts';
import type { Gate } from '../effects/gate.ts';
import type { ReceiptStore } from '../effects/receipts.ts';
import { AcpAgent } from '../external/acp.ts';
import { findOpenCode, spawnOpenCode } from '../external/opencode.ts';
import { permissionEffect } from '../external/permission.ts';
import {
  addWorktree,
  hasUncommitted,
  git,
  isGitRepo,
  toRepoPath,
  verifyWorktree,
} from '../external/worktree.ts';
import type { SettingsStore } from '../store/settings.ts';
import type { Job, JobCheck, JobResult, JobStore, JobStatus } from './store.ts';

export class JobError extends Error {}

export interface JobRunnerDeps {
  jobs: JobStore;
  gate: Gate;
  receipts: ReceiptStore;
  executor: Executor;
  settings: SettingsStore;
  dataDir: string;
  /** Where to find OpenCode; default: ROCKY_OPENCODE_BIN or PATH. */
  findAgent?: () => string | undefined;
}

export interface JobInput {
  threadId: string;
  runId?: string;
  toolCallId?: string;
  title: string;
  task: string;
}

/** Follow-up prompts after a rejection (OpenCode ends its turn on every reject). */
const MAX_FOLLOW_UPS = 3;
const CHECK_TIMEOUT_MS = 10 * 60_000;

const GUIDANCE = [
  "You are working in a git worktree of the user's project. Rocky, the user's assistant, approves each change and command.",
  "Make the smallest change that solves the task. Run the project's tests after changing code.",
  'If an action is rejected, follow the reason given and choose a different approach.',
  'Finish with a short summary of what you changed and the test result.',
].join('\n');

/** Whether the project had a test script when the job started. Read from the base commit,
 * so the agent cannot skip Rocky's check by deleting or renaming the script. */
export async function baseHasTestScript(
  worktree: string,
  base: string,
): Promise<boolean> {
  try {
    const pkg = JSON.parse(
      await git(worktree, 'show', `${base}:package.json`),
    ) as { scripts?: Record<string, string> };
    return typeof pkg.scripts?.['test'] === 'string';
  } catch {
    return false;
  }
}

/** Approvals and receipts of a job's own actions live in this thread, not the conversation's. */
export const jobThread = (jobId: string) => `job:${jobId}`;

interface Prepared {
  project: string;
  bin: string;
  model: { baseURL: string; model: string; apiKey?: string | undefined };
}

export class JobRunner {
  private readonly deps: JobRunnerDeps;
  private readonly queue: { job: Job; prepared: Prepared }[] = [];
  private readonly controllers = new Map<string, AbortController>();
  private readonly finished = new Map<string, Promise<Job>>();
  private readonly resolvers = new Map<string, (job: Job) => void>();
  private active: string | undefined;

  constructor(deps: JobRunnerDeps) {
    this.deps = deps;
  }

  /** Called whenever a job's timeline or status changes. */

  available(): boolean {
    return (this.deps.findAgent ?? findOpenCode)() !== undefined;
  }

  /** Checks that fail before any job exists, with a code the model and the UI can explain. */
  private async preflight(): Promise<Prepared> {
    const { settings } = this.deps;
    const project = settings.project();
    if (!project) throw new JobError('no-project');
    if (!(await isGitRepo(project))) throw new JobError('not-a-git-repo');
    const bin = (this.deps.findAgent ?? findOpenCode)();
    if (!bin) throw new JobError('opencode-not-found');
    const model = settings.model();
    if (!model) throw new JobError('model-not-configured');
    return {
      project,
      bin,
      model: { ...model, apiKey: settings.apiKey() },
    };
  }

  /** Puts a job in the queue and returns at once; it runs in the background, one at a time. */
  async enqueue(input: JobInput): Promise<Job> {
    const prepared = await this.preflight();
    const job = this.deps.jobs.create({ ...input, agent: 'opencode' });
    this.finished.set(
      job.id,
      new Promise<Job>((resolve) => this.resolvers.set(job.id, resolve)),
    );
    this.queue.push({ job, prepared });
    void this.next();
    return this.deps.jobs.get(job.id)!;
  }

  /** Resolves when the job has finished (or at once if it already has). */
  wait(jobId: string): Promise<Job> {
    return (
      this.finished.get(jobId) ?? Promise.resolve(this.deps.jobs.get(jobId)!)
    );
  }

  /** Position in the queue (1 = next), 0 when running, undefined when not waiting. */
  position(jobId: string): number | undefined {
    if (this.active === jobId) return 0;
    const index = this.queue.findIndex((q) => q.job.id === jobId);
    return index < 0 ? undefined : index + 1;
  }

  /** Stops a running job, or takes a queued one out of the queue. False if it is neither. */
  cancel(jobId: string): boolean {
    const index = this.queue.findIndex((q) => q.job.id === jobId);
    if (index >= 0) {
      this.queue.splice(index, 1);
      this.deps.jobs.finish(jobId, 'stopped', null);
      this.deps.jobs.addEvent(jobId, { type: 'status', text: 'stopped' });
      this.settle(jobId);
      return true;
    }
    const controller = this.controllers.get(jobId);
    if (!controller) return false;
    controller.abort();
    return true;
  }

  /** At shutdown: stop the running job and drop the queue (they become interrupted next start). */
  close(): void {
    this.queue.length = 0;
    for (const controller of this.controllers.values()) controller.abort();
  }

  private settle(jobId: string): void {
    this.resolvers.get(jobId)?.(this.deps.jobs.get(jobId)!);
    this.resolvers.delete(jobId);
    this.finished.delete(jobId);
  }

  private async next(): Promise<void> {
    if (this.active) return;
    const item = this.queue.shift();
    if (!item) return;
    const { job, prepared } = item;
    this.active = job.id;
    const controller = new AbortController();
    this.controllers.set(job.id, controller);
    this.deps.jobs.setStatus(job.id, 'running');
    try {
      await this.execute(job, prepared, controller.signal);
    } finally {
      this.controllers.delete(job.id);
      this.active = undefined;
      this.settle(job.id);
      void this.next();
    }
  }

  private async execute(
    job: Job,
    { project, bin, model }: Prepared,
    signal: AbortSignal,
  ): Promise<void> {
    const { jobs, gate, receipts, dataDir } = this.deps;
    const thread = jobThread(job.id);
    const event = (e: Parameters<JobStore['addEvent']>[1]) => {
      jobs.addEvent(job.id, e);
    };
    const warnings: string[] = [];
    let status: JobStatus = 'failed';
    let result: JobResult = {
      stopReason: null,
      summary: '',
      changed: [],
      unapproved: [],
      mismatched: [],
      diff: '',
      checks: [],
      warnings,
    };

    let agent: AcpAgent | undefined;
    let sessionId: string | undefined;
    const onAbort = () => {
      if (agent && sessionId) void agent.cancel(sessionId);
    };
    signal.addEventListener('abort', onAbort, { once: true });
    try {
      // 1. A worktree at HEAD, on its own branch, under Rocky's data folder.
      const branch = `rocky/job-${job.id.slice(0, 8)}`;
      mkdirSync(join(dataDir, 'worktrees'), { recursive: true });
      const tree = await addWorktree(
        project,
        join(dataDir, 'worktrees', job.id),
        branch,
      );
      const worktree = tree.path;
      jobs.setWorkspace(job.id, { worktree, branch, baseCommit: tree.base });
      if (await hasUncommitted(project)) warnings.push('uncommitted-changes');
      // Installed dependencies are not in Git; share the project's so tests can run.
      const modules = join(project, 'node_modules');
      if (existsSync(modules) && !existsSync(join(worktree, 'node_modules'))) {
        symlinkSync(modules, join(worktree, 'node_modules'), 'junction');
      }
      event({ type: 'status', text: 'worktree-ready' });

      // 2. OpenCode over ACP. Every permission request goes through the gate.
      const approved = new Map<string, string>();
      const receiptOf = new Map<string, string>();
      let rejection: string | undefined;
      let text = '';
      let lastText = '';
      const flush = () => {
        if (text.trim()) {
          event({ type: 'message', text });
          lastText = text;
        }
        text = '';
      };
      const origin = (toolCallId: string) => ({
        threadId: thread,
        runId: thread,
        toolCallId,
        actor: 'opencode' as const,
      });

      agent = new AcpAgent(
        spawnOpenCode(bin, join(dataDir, 'opencode'), worktree, model),
        {
          decide: async (request) => {
            flush();
            const mapped = permissionEffect(request, worktree);
            const id = request.toolCall.toolCallId;
            const decision = await gate.request(
              mapped.effect,
              origin(id),
              signal,
              {
                root: worktree,
                ...(mapped.before !== undefined
                  ? { before: mapped.before }
                  : {}),
              },
            );
            const title = request.toolCall.title ?? request.toolCall.kind ?? '';
            if (!decision.allowed) {
              rejection = decision.message;
              event({
                type: 'permission',
                id,
                title,
                decision: 'reject',
                receiptId: decision.receipt.id,
              });
              return 'reject';
            }
            // Rocky does not execute it; the pass is used up here and OpenCode acts.
            gate.passes.redeem(decision.pass, contentHash(mapped.effect));
            if (decision.receipt) receiptOf.set(id, decision.receipt.id);
            if (mapped.effect.kind === 'write')
              approved.set(
                toRepoPath(worktree, mapped.effect.path),
                mapped.effect.content ?? '',
              );
            event({
              type: 'permission',
              id,
              title,
              decision: 'allow',
              receiptId: decision.receipt?.id ?? null,
            });
            return 'allow';
          },
          update: (notification: SessionNotification) => {
            const u = notification.update;
            if (
              u.sessionUpdate === 'agent_message_chunk' &&
              u.content.type === 'text'
            ) {
              text += u.content.text;
            } else if (u.sessionUpdate === 'tool_call') {
              flush();
              event({
                type: 'tool',
                id: u.toolCallId,
                title: u.title,
                kind: u.kind ?? 'other',
                status: u.status ?? 'pending',
              });
            } else if (
              u.sessionUpdate === 'tool_call_update' &&
              (u.status === 'completed' || u.status === 'failed')
            ) {
              flush();
              event({
                type: 'tool',
                id: u.toolCallId,
                title: u.title ?? '',
                kind: u.kind ?? 'other',
                status: u.status,
              });
              const receiptId = receiptOf.get(u.toolCallId);
              if (receiptId && receipts.get(receiptId)?.outcome === 'pending') {
                receipts.finish(
                  receiptId,
                  u.status === 'completed' ? 'succeeded' : 'failed',
                );
              }
            }
          },
        },
      );
      await agent.initialize();
      sessionId = await agent.newSession(worktree);
      jobs.setSession(job.id, sessionId);
      // Stopped while OpenCode was starting: never send it the task.
      let prompt = `${GUIDANCE}\n\nTask:\n${job.task}`;
      for (let round = 0; !signal.aborted; round++) {
        event({ type: 'prompt', text: round === 0 ? job.task : prompt });
        rejection = undefined;
        const response = await agent.prompt(sessionId, prompt);
        flush();
        result.stopReason = response.stopReason;
        if (signal.aborted || response.stopReason === 'cancelled') break;
        if (!rejection || round >= MAX_FOLLOW_UPS) break;
        prompt = rejection;
      }
      result.summary = lastText.trim();
      await agent.close();
      agent = undefined;

      // 3. Rocky's own verification: what changed, and does it match what was approved.
      const verification = await verifyWorktree(worktree, tree.base, approved);
      result = { ...result, ...verification };
      // Approved actions OpenCode never reported back: their outcome is not known.
      for (const receiptId of receiptOf.values()) {
        if (receipts.get(receiptId)?.outcome === 'pending')
          receipts.finish(receiptId, 'unknown', 'not reported by OpenCode');
      }

      // 4. Rocky runs the checks itself, through the gate like any other command.
      if (
        !signal.aborted &&
        verification.changed.length > 0 &&
        (await baseHasTestScript(worktree, tree.base))
      ) {
        result.checks.push(
          await this.check(thread, worktree, ['npm', 'test'], signal),
        );
      }

      status = signal.aborted
        ? 'stopped'
        : verification.unapproved.length > 0 ||
            verification.mismatched.length > 0 ||
            result.checks.some((c) => c.exitCode !== 0)
          ? 'problems'
          : 'verified';
    } catch (error) {
      result.error = error instanceof Error ? error.message : String(error);
      if (agent?.stderr) result.error += `\n${agent.stderr.slice(-2000)}`;
      status = signal.aborted ? 'stopped' : 'failed';
    } finally {
      signal.removeEventListener('abort', onAbort);
      if (agent) await agent.close();
      jobs.finish(job.id, status, result);
      event({ type: 'status', text: status });
    }
  }

  private async check(
    thread: string,
    worktree: string,
    argv: string[],
    signal: AbortSignal,
  ): Promise<JobCheck> {
    const effect = { kind: 'command' as const, argv, cwd: worktree };
    const decision = await this.deps.gate.request(
      effect,
      { threadId: thread, runId: thread, actor: 'rocky' },
      signal,
      { root: worktree },
    );
    if (!decision.allowed)
      return { argv, exitCode: null, output: decision.message };
    const run = await this.deps.executor.run(decision.pass, effect, {
      timeoutMs: CHECK_TIMEOUT_MS,
      signal,
    });
    return { argv, exitCode: run.exitCode, output: run.output.slice(-4000) };
  }
}
