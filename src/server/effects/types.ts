// What an action is, who asked for it, and how Rocky decided.

export type { Actor, Effect, Mode, PlanOption } from '../../shared/types.ts';

export type Decision = 'allow' | 'ask' | 'deny';

export type Reason =
  | 'deny-rule'
  | 'dangerous'
  | 'secret'
  | 'protected'
  | 'external'
  | 'session-approved'
  | 'allow-rule'
  | 'mode'
  | 'plan'
  /** In plan mode Rocky only reads; anything else is refused until the user picks a plan. */
  | 'plan-mode';

export interface Verdict {
  decision: Decision;
  reason: Reason;
  /** Machine detail, e.g. which danger or which path. */
  detail?: string;
  /** Binds an approval and a pass to this exact content. */
  contentHash: string;
  /** For a question: the category "allow for this conversation" remembers, e.g.
   * "dangerous:recursive-delete", "external:command:git", "external:mcp:notes/write". */
  grant?: string;
}

export interface Rule {
  decision: 'allow' | 'deny';
  /** Argv prefix; `*` as the last element matches any remaining arguments. */
  prefix: string[];
}
