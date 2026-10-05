// The action gate: one entry point for every action that changes the outside world.
// It decides (policy.ts), asks the user when needed, records a receipt before acting,
// and hands out a single-use pass bound to the exact content.
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { PassBook, type Pass } from './passes.ts';
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
  createdAt: number;
}

export type UserDecision =
  | { decision: 'allow-once'; contentHash: string }
  | { decision: 'allow-session'; contentHash: string }
  | { decision: 'reject'; contentHash: string; reason?: string };

export type GateResult =
  /** receipt is undefined only for reads that needed no question: they change nothing. */
  | { allowed: true; pass: Pass; receipt: Receipt | undefined }
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

  private changed(threadId: string): void {
    for (const listener of this.listeners.get(threadId) ?? []) listener();
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

  context(threadId: string): PolicyContext {
    const projectRoot = this.deps.projectRoot();
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
    preview: { before?: string } = {},
  ): Promise<GateResult> {
    const verdict = decide(effect, this.context(origin.threadId));
    const tool = effect.kind === 'command' ? 'run_command' : effect.kind;
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
  ): GateResult {
    const verdict = decide(effect, this.context(origin.threadId));
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

  /** The user's answer to a pending approval. False when it is no longer pending. */
  answer(approvalId: string, decision: UserDecision): boolean {
    const waiting = this.waiting.get(approvalId);
    if (!waiting) return false;
    waiting.resolve(decision);
    return true;
  }
}
