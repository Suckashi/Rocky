// The action gate: one entry point for every action that changes the outside world.
// It decides (policy.ts), asks the user when needed, records a receipt before acting,
// and hands out a single-use pass bound to the exact content.
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { PassBook, type Pass } from './passes.ts';
import { alwaysRule, decide, type PolicyContext } from './policy.ts';
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
  /** What "allow for this conversation" would allow (a category, see Verdict.grant). */
  grant: string | null;
  /** Commands only: the rule "always allow" would save. */
  always: string[] | null;
  createdAt: number;
}

export type UserDecision =
  | { decision: 'allow-once'; contentHash: string }
  | { decision: 'allow-session'; contentHash: string }
  /** Commands only: save PendingApproval.always as a permanent allow rule. */
  | { decision: 'allow-always'; contentHash: string }
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
  mode: () => Mode;
  rules: () => Rule[];
  /** Saves an "always allow" rule the user chose in the approval panel. */
  addRule: (rule: Rule) => void;
  /** Plan mode for a conversation, and turning it off once the user picks a plan. */
  planning: (threadId: string) => boolean;
  setPlanning: (threadId: string, on: boolean) => void;
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
  private readonly grants = new Map<string, Set<string>>();
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

  /** Plan mode for a conversation (ADR 0019). */
  planning(threadId: string): boolean {
    return this.deps.planning(threadId);
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
      mode: this.deps.mode(),
      planning: this.deps.planning(threadId),
      rules: this.deps.rules(),
      grants: this.grants.get(threadId) ?? new Set(),
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
      verdict.reason === 'plan-mode' && effect.kind !== 'plan'
        ? `${effect.kind === 'command' ? 'run_command' : effect.kind} (plan mode)`
        : effect.kind === 'command'
          ? 'run_command'
          : effect.kind === 'plan'
            ? 'propose_plan'
            : effect.kind === 'delegate'
              ? 'delegate_to_opencode'
              : effect.kind;
    if (verdict.decision === 'deny') {
      return this.refuse(
        origin,
        effect,
        verdict,
        'denied',
        verdict.detail,
        verdict.reason === 'plan-mode'
          ? effect.kind === 'plan'
            ? 'propose_plan is only for plan mode, which is off. Do the task directly.'
            : `${tool} was not run: plan mode is on, so only reading is allowed. Finish exploring and present the plan with propose_plan; the user turns plan mode off by choosing an option.`
          : `${tool} is not allowed (${verdict.reason}). Do not retry it.`,
      );
    }
    if (verdict.decision === 'allow' && effect.kind === 'read') {
      return {
        allowed: true,
        receipt: undefined,
        pass: this.passes.issue(verdict.contentHash, ''),
      };
    }
    if (verdict.decision === 'allow') {
      return this.permit(origin, effect, verdict, 'allowed');
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
      grant: verdict.grant ?? null,
      always: effect.kind === 'command' ? alwaysRule(effect.argv) : null,
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
      return this.refuse(
        origin,
        effect,
        verdict,
        'rejected',
        'stopped',
        `${tool} was not run: the run was stopped.`,
      );
    }
    // The approval binds to the exact content the user saw; anything else means ask again.
    if (answer.contentHash !== verdict.contentHash) {
      return this.refuse(
        origin,
        effect,
        verdict,
        'rejected',
        'content-changed',
        `${tool} was not run: the approved content does not match. Ask again.`,
      );
    }
    if (effect.kind === 'plan') {
      return this.planAnswer(effect, origin, verdict, answer);
    }
    // Choosing and revising only make sense for plans, "always" only for commands;
    // anything else is a rejection.
    if (
      answer.decision === 'choose' ||
      answer.decision === 'revise' ||
      (answer.decision === 'allow-always' && effect.kind !== 'command')
    ) {
      return this.refuse(
        origin,
        effect,
        verdict,
        'rejected',
        'invalid-answer',
        `${tool} was not run: the answer did not fit this request.`,
      );
    }
    if (answer.decision === 'reject') {
      return this.refuse(
        origin,
        effect,
        verdict,
        'rejected',
        answer.reason,
        REJECTED_MESSAGE(tool, answer.reason),
      );
    }
    if (answer.decision === 'allow-session' && verdict.grant) {
      const set = this.grants.get(origin.threadId) ?? new Set<string>();
      set.add(verdict.grant);
      this.grants.set(origin.threadId, set);
      // Questions of the same category already waiting in this conversation are answered too.
      for (const other of this.pending(origin.threadId))
        if (other.grant === verdict.grant)
          this.answer(other.id, {
            decision: 'allow-once',
            contentHash: other.contentHash,
          });
    }
    if (answer.decision === 'allow-always' && effect.kind === 'command')
      this.deps.addRule({ decision: 'allow', prefix: alwaysRule(effect.argv) });
    return this.permit(origin, effect, verdict, 'approved');
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
      return this.refuse(
        origin,
        effect,
        verdict,
        'denied',
        verdict.detail,
        verdict.reason,
      );
    }
    if (seenHash !== verdict.contentHash) {
      return this.refuse(
        origin,
        effect,
        verdict,
        'rejected',
        'content-changed',
        'content-changed',
      );
    }
    return this.permit(origin, effect, verdict, 'approved');
  }

  /** The plan that ends plan mode: choosing an option turns plan mode off for the conversation. */
  private planAnswer(
    effect: Extract<Effect, { kind: 'plan' }>,
    origin: Origin & { threadId: string },
    verdict: { contentHash: string; reason: Reason },
    answer: UserDecision,
  ): GateResult {
    if (answer.decision === 'choose') {
      const option = effect.options[answer.option];
      if (option) {
        this.deps.setPlanning(origin.threadId, false);
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
    return this.refuse(
      origin,
      effect,
      verdict,
      'rejected',
      answer.decision === 'revise' ? `revise: ${feedback ?? ''}` : feedback,
      answer.decision === 'revise'
        ? `The user wants changes to the plan: ${feedback?.trim() || 'none given'}. Revise it and call propose_plan again; do not start the work yet.`
        : `The user rejected the plan. Reason: ${feedback?.trim() || 'none given'}. Do not carry it out; ask the user how to proceed.`,
    );
  }

  /** Records that the action may run and issues the pass for exactly this content. */
  private permit(
    origin: Origin,
    effect: Effect,
    verdict: { contentHash: string; reason: Reason },
    decision: 'allowed' | 'approved',
  ): GateResult {
    const receipt = this.deps.receipts.intent(
      origin,
      effect,
      verdict,
      decision,
    );
    return {
      allowed: true,
      receipt,
      pass: this.passes.issue(verdict.contentHash, receipt.id),
    };
  }

  /** Records that the action was not run (refused or rejected) and tells the caller why. */
  private refuse(
    origin: Origin,
    effect: Effect,
    verdict: { contentHash: string; reason: Reason },
    decision: 'denied' | 'rejected',
    detail: string | undefined,
    message: string,
  ): GateResult {
    const receipt = this.deps.receipts.intent(
      origin,
      effect,
      verdict,
      decision,
      detail,
    );
    return { allowed: false, receipt, message };
  }

  /** The user's answer to a pending approval. False when it is no longer pending. */
  answer(approvalId: string, decision: UserDecision): boolean {
    const waiting = this.waiting.get(approvalId);
    if (!waiting) return false;
    waiting.resolve(decision);
    return true;
  }
}
