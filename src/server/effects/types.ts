// What an action is, who asked for it, and how Rocky decided.

/** 'user': actions the user started from the interface, such as restoring files. */
export type Actor = 'rocky' | 'subagent' | 'opencode' | 'user';
export type Mode = 'ask-always' | 'ask-when-needed' | 'hands-off';

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
  /** Plan review (approvals.md): the user picks one option, asks for changes, or rejects. */
  | { kind: 'plan'; title: string; options: PlanOption[] };

export interface PlanOption {
  title: string;
  summary: string;
  steps: string[];
  /** Commands this option will run in the project root; choosing it approves exactly these. */
  commands: string[][];
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
  | 'safe-list'
  | 'unparseable'
  | 'mode'
  | 'plan';

export interface Verdict {
  decision: Decision;
  reason: Reason;
  /** Machine detail, e.g. which danger or which path. */
  detail?: string;
  /** Binds an approval and a pass to this exact content. */
  contentHash: string;
  /** What "allow for this session" remembers. */
  sessionKey: string;
}

export interface Rule {
  decision: 'allow' | 'deny';
  /** Argv prefix; `*` as the last element matches any remaining arguments. */
  prefix: string[];
}
