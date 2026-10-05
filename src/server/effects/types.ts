// What an action is, who asked for it, and how Rocky decided.

export type Actor = 'rocky' | 'subagent' | 'opencode';
export type Mode = 'ask-always' | 'ask-when-needed' | 'hands-off';

export type Effect =
  | { kind: 'read'; path: string }
  | {
      kind: 'write';
      path: string;
      operation: 'create' | 'edit' | 'delete';
      content?: string;
    }
  | { kind: 'command'; argv: string[]; cwd: string }
  | {
      kind: 'mcp';
      server: string;
      tool: string;
      args: unknown;
      readOnly: boolean;
    }
  | { kind: 'network'; method: string; url: string };

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
  | 'mode';

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
