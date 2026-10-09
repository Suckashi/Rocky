// Types the server and the browser share: what crosses the local API. The server's own
// logic lives next to it; only the shapes both sides read are here.

/** 'user': actions the user started from the interface, such as restoring files. */
export type Actor = 'rocky' | 'subagent' | 'opencode' | 'user';
/** ask-when-needed asks at the floors; hands-off asks only to read secrets (ADR 0019). */
export type Mode = 'ask-when-needed' | 'hands-off';

export type Effect =
  | {
      kind: 'read';
      path: string;
      /** The agent's own config marked it secret but it did not say which file (OpenCode
       * sends no path with the question); path is then its worktree. */
      secret?: true;
    }
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

export type Locale = 'zh-TW' | 'en';
export type Provider = 'openai-compatible' | 'openai' | 'ollama';

export type ReceiptDecision = 'allowed' | 'approved' | 'rejected' | 'denied';
export type Outcome =
  'pending' | 'succeeded' | 'failed' | 'unknown' | 'not-run';

export type JobStatus =
  /** Waiting for its turn: one external agent job runs at a time. */
  | 'queued'
  | 'running'
  /** Rocky checked the worktree against its approvals and the checks passed. */
  | 'verified'
  /** Finished, but verification found unapproved changes or failing checks. */
  | 'problems'
  | 'failed'
  | 'stopped'
  /** Rocky ended while the job ran; its outcome is unknown and it is never restarted. */
  | 'interrupted'
  | 'applied'
  | 'discarded';
