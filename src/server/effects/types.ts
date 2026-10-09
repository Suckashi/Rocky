// What an action is, who asked for it, and how Rocky decided.

/** 'user': actions the user started from the interface, such as restoring files. */
export type Actor = 'rocky' | 'subagent' | 'opencode' | 'user';
/** ask-when-needed asks at the floors; hands-off asks only to read secrets (ADR 0019). */
export type Mode = 'ask-when-needed' | 'hands-off';

export type Effect =
  | { kind: 'read'; path: string }
  | {
      kind: 'write';
      path: string;
      operation: 'create' | 'edit' | 'delete';
      content?: string;
      /** base64: content is binary (documents); default utf8 text. */
      encoding?: 'base64';
      /** Readable form of the new content (Markdown of a document), for the approval diff. */
      preview?: string;
    }
  | { kind: 'command'; argv: string[]; cwd: string }
  | {
      kind: 'mcp';
      server: string;
      tool: string;
      args: unknown;
      readOnly: boolean;
    }
  /** The plan at the end of plan mode (ADR 0019): the user picks one option, asks for changes, or rejects. */
  | { kind: 'plan'; title: string; options: PlanOption[] };

export interface PlanOption {
  title: string;
  summary: string;
  steps: string[];
}

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
