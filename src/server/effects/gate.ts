// The action gate: one entry point for every action that changes the outside world.
// It decides (policy.ts), asks the user when needed, records a receipt before acting,
// and hands out a single-use pass bound to the exact content.
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { PassBook, type Pass } from './passes.ts';
import { sessionKey } from './hash.ts';
import { decide, type PolicyContext } from './policy.ts';
import type { Origin, Receipt, ReceiptStore } from './receipts.ts';
import type { Effect, Mode, Reason, Rule } from './types.ts';

export interface PendingApproval {
  id: string;
  threadId: string;
  toolCallId: string | null;
  actor: Origin['actor'];
  effect: Effect;
  contentHash: string;
  reason: Reason;
  detail: string | null;
  /** For writes: the current file content, so the UI can show a diff. */
  before: string | null;
  /** The folder paths are relative to, when it is not the project (an external agent's worktree). */
  root: string | null;
  createdAt: number;
}

export type UserDecision =
  | { decision: 'allow-once'; contentHash: string }
  | { decision: 'allow-session'; contentHash: string }
  | { decision: 'reject'; contentHash: string; reason?: string }
  /** Plans only: the option the user picked (0-based). */
  | { decision: 'choose'; contentHash: string; option: number }
  /** Plans only: what the user wants changed. */
  | { decision: 'revise'; contentHash: string; feedback: string };

export type GateResult =
  /** receipt is undefined only for reads that needed no question: they change nothing. */
  | {
      allowed: true;
      pass: Pass;
      receipt: Receipt | undefined;
      /** For a plan: the option the user chose. */
      choice?: number;
    }
  | { allowed: false; receipt: Receipt; message: string };

export interface GateDeps {
  receipts: ReceiptStore;
  projectRoot: () => string | undefined;
  defaultMode: () => Mode;
  rules: () => Rule[];
  safeList: (projectRoot: string) => string[][];
  /** Paths Rocky itself created in a thread (they may be deleted without asking). */
  createdByRocky: (threadId: string, absolutePath: string) => boolean;
}

interface Waiting {
  approval: PendingApproval;
  resolve: (decision: UserDecision | 'stopped') => void;
}

export const REJECTED_MESSAGE = (tool: string, reason: string | undefined) =>
  `${tool} was not run because the user rejected it. Reason: ${reason?.trim() || 'none given'}. Do not retry the same way; choose a different approach.`;

export class Gate {
  readonly passes = new PassBook();
  private readonly deps: GateDeps;
  private readonly waiting = new Map<string, Waiting>();
  private readonly sessionApprovals = new Map<string, Set<string>>();
  private readonly modes = new Map<string, Mode>();
  private readonly listeners = new Map<string, Set<() => void>>();
  private readonly anyListeners = new Set<(threadId: string) => void>();

  constructor(deps: GateDeps) {
    this.deps = deps;
  }

  /** Called whenever the thread's pending approvals change; returns an unsubscribe function. */
  subscribe(threadId: string, listener: () => void): () => void {
    const set = this.listeners.get(threadId) ?? new Set();
    set.add(listener);
    this.listeners.set(threadId, set);
    return () => set.delete(listener);
  }

  /** Called whenever any thread's pending approvals change (background jobs ask in their own). */
  subscribeAll(listener: (threadId: string) => void): () => void {
    this.anyListeners.add(listener);
    return () => this.anyListeners.delete(listener);
  }

  private changed(threadId: string): void {
    for (const listener of this.listeners.get(threadId) ?? []) listener();
    for (const listener of this.anyListeners) listener(threadId);
  }

  mode(threadId: string): Mode {
    return this.modes.get(threadId) ?? this.deps.defaultMode();
  }

  setMode(threadId: string, mode: Mode): void {
    this.modes.set(threadId, mode);
  }

  pending(threadId: string): PendingApproval[] {
    return [...this.waiting.values()]
      .map((w) => w.approval)
      .filter((a) => a.threadId === threadId)
      .sort((a, b) => a.createdAt - b.createdAt);
  }

  /** One pending approval by id (for previews of what it would write). */
  find(approvalId: string): PendingApproval | undefined {
    return this.waiting.get(approvalId)?.approval;
  }

  /** root: judge paths against this folder instead of the project (an external agent's worktree). */
  context(threadId: string, root?: string): PolicyContext {
    const projectRoot = root ?? this.deps.projectRoot();
    if (!projectRoot) throw new Error('no-project');
    return {
      projectRoot,
      mode: this.mode(threadId),
      rules: this.deps.rules(),
      sessionApprovals: this.sessionApprovals.get(threadId) ?? new Set(),
      safeList: this.deps.safeList(projectRoot),
      existedBefore: (p) =>
        existsSync(p) && !this.deps.createdByRocky(threadId, p),
    };
  }

  /** Decide on an action; ask and wait when needed. The signal cancels a pending question. */
  async request(
    effect: Effect,
    origin: Origin & { threadId: string },
    signal?: AbortSignal,
    preview: { before?: string; root?: string } = {},
  ): Promise<GateResult> {
    const verdict = decide(effect, this.context(origin.threadId, preview.root));
    const tool =
      effect.kind === 'command'
        ? 'run_command'
        : effect.kind === 'plan'
          ? 'propose_plan'
          : effect.kind;
    if (verdict.decision === 'deny') {
      const receipt = this.deps.receipts.intent(
        origin,
        effect,
        verdict,
        'denied',
        verdict.detail,
      );
      return {
        allowed: false,
        receipt,
        message: `${tool} is not allowed (${verdict.reason}). Do not retry it.`,
      };
    }
    if (verdict.decision === 'allow' && effect.kind === 'read') {
      return {
        allowed: true,
        receipt: undefined,
        pass: this.passes.issue(verdict.contentHash, ''),
      };
    }
    if (verdict.decision === 'allow') {
      const receipt = this.deps.receipts.intent(
        origin,
        effect,
        verdict,
        'allowed',
      );
      return {
        allowed: true,
        receipt,
        pass: this.passes.issue(verdict.contentHash, receipt.id),
      };
    }

    const approval: PendingApproval = {
      id: randomUUID(),
      threadId: origin.threadId,
      toolCallId: origin.toolCallId ?? null,
      actor: origin.actor,
      effect,
      contentHash: verdict.contentHash,
      reason: verdict.reason,
      detail: verdict.detail ?? null,
      before: preview.before ?? null,
      root: preview.root ?? null,
      createdAt: Date.now(),
    };
    const answer = await new Promise<UserDecision | 'stopped'>((resolve) => {
      this.waiting.set(approval.id, { approval, resolve });
      this.changed(origin.threadId);
      if (signal?.aborted) resolve('stopped');
      signal?.addEventListener('abort', () => resolve('stopped'), {
        once: true,
      });
    });
    this.waiting.delete(approval.id);
    this.changed(origin.threadId);

    if (answer === 'stopped') {
      const receipt = this.deps.receipts.intent(
        origin,
        effect,
        verdict,
        'rejected',
        'stopped',
      );
      return {
        allowed: false,
        receipt,
        message: `${tool} was not run: the run was stopped.`,
      };
    }
    // The approval binds to the exact content the user saw; anything else means ask again.
    if (answer.contentHash !== verdict.contentHash) {
      const receipt = this.deps.receipts.intent(
        origin,
        effect,
        verdict,
        'rejected',
        'content-changed',
      );
      return {
        allowed: false,
        receipt,
        message: `${tool} was not run: the approved content does not match. Ask again.`,
      };
    }
    if (effect.kind === 'plan') {
      return this.planAnswer(effect, origin, verdict, answer, preview.root);
    }
    // Choosing and revising only make sense for plans; anything else is a rejection.
    if (answer.decision === 'choose' || answer.decision === 'revise') {
      const receipt = this.deps.receipts.intent(
        origin,
        effect,
        verdict,
        'rejected',
        'invalid-answer',
      );
      return {
        allowed: false,
        receipt,
        message: `${tool} was not run: the answer did not fit this request.`,
      };
    }
    if (answer.decision === 'reject') {
      const receipt = this.deps.receipts.intent(
        origin,
        effect,
        verdict,
        'rejected',
        answer.reason,
      );
      return {
        allowed: false,
        receipt,
        message: REJECTED_MESSAGE(tool, answer.reason),
      };
    }
    if (answer.decision === 'allow-session') {
      const set =
        this.sessionApprovals.get(origin.threadId) ?? new Set<string>();
      set.add(verdict.sessionKey);
      this.sessionApprovals.set(origin.threadId, set);
    }
    const receipt = this.deps.receipts.intent(
      origin,
      effect,
      verdict,
      'approved',
    );
    return {
      allowed: true,
      receipt,
      pass: this.passes.issue(verdict.contentHash, receipt.id),
    };
  }

  /**
   * An action the user started from the interface after seeing a preview (restore). The
   * click is the approval, bound to the content hash of the preview; deny decisions still win.
   */
  userAction(
    effect: Effect,
    origin: Origin & { threadId: string },
    seenHash: string,
    root?: string,
  ): GateResult {
    const verdict = decide(effect, this.context(origin.threadId, root));
    if (verdict.decision === 'deny') {
      const receipt = this.deps.receipts.intent(
        origin,
        effect,
        verdict,
        'denied',
        verdict.detail,
      );
      return { allowed: false, receipt, message: verdict.reason };
    }
    if (seenHash !== verdict.contentHash) {
      const receipt = this.deps.receipts.intent(
        origin,
        effect,
        verdict,
        'rejected',
        'content-changed',
      );
      return { allowed: false, receipt, message: 'content-changed' };
    }
    const receipt = this.deps.receipts.intent(
      origin,
      effect,
      verdict,
      'approved',
    );
    return {
      allowed: true,
      receipt,
      pass: this.passes.issue(verdict.contentHash, receipt.id),
    };
  }

  /**
   * A plan review: the chosen option's commands become approved for this conversation,
   * exactly as listed (argv and the project folder), so running them does not ask again.
   * Dangerous commands and outside actions still ask: the policy checks those first.
   */
  private planAnswer(
    effect: Extract<Effect, { kind: 'plan' }>,
    origin: Origin & { threadId: string },
    verdict: { contentHash: string; reason: Reason; sessionKey: string },
    answer: UserDecision,
    root: string | undefined,
  ): GateResult {
    if (answer.decision === 'choose') {
      const option = effect.options[answer.option];
      if (option) {
        const cwd = root ?? this.deps.projectRoot();
        if (cwd) {
          const set =
            this.sessionApprovals.get(origin.threadId) ?? new Set<string>();
          for (const argv of option.commands)
            set.add(sessionKey({ kind: 'command', argv, cwd }));
          this.sessionApprovals.set(origin.threadId, set);
        }
        const receipt = this.deps.receipts.intent(
          origin,
          effect,
          verdict,
          'approved',
          `option ${answer.option + 1}: ${option.title}`,
        );
        // Choosing changes nothing outside; the decision itself is the outcome.
        this.deps.receipts.finish(receipt.id, 'succeeded');
        return {
          allowed: true,
          receipt,
          pass: this.passes.issue(verdict.contentHash, receipt.id),
          choice: answer.option,
        };
      }
    }
    const feedback =
      answer.decision === 'revise'
        ? answer.feedback
        : answer.decision === 'reject'
          ? answer.reason
          : undefined;
    const receipt = this.deps.receipts.intent(
      origin,
      effect,
      verdict,
      'rejected',
      answer.decision === 'revise' ? `revise: ${feedback ?? ''}` : feedback,
    );
    return {
      allowed: false,
      receipt,
      message:
        answer.decision === 'revise'
          ? `The user wants changes to the plan: ${feedback?.trim() || 'none given'}. Revise it and call propose_plan again; do not start the work yet.`
          : `The user rejected the plan. Reason: ${feedback?.trim() || 'none given'}. Do not carry it out; ask the user how to proceed.`,
    };
  }

  /** The user's answer to a pending approval. False when it is no longer pending. */
  answer(approvalId: string, decision: UserDecision): boolean {
    const waiting = this.waiting.get(approvalId);
    if (!waiting) return false;
    waiting.resolve(decision);
    return true;
  }
}
