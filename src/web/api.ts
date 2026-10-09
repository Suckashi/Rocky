// Calls Rocky's local API. The session cookie travels with same-origin requests.
export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, code: string) {
    super(code);
    this.status = status;
  }
}

export async function api<T>(
  path: string,
  method = 'GET',
  body?: unknown,
): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok)
    throw new ApiError(
      response.status,
      data.error ?? `http-${response.status}`,
    );
  return data as T;
}

export type Provider = 'openai-compatible' | 'openai' | 'ollama';
export type Locale = 'zh-TW' | 'en';

export interface ModelSettings {
  provider: Provider;
  baseURL: string;
  model: string;
  hasApiKey: boolean;
}

export type Mode = 'ask-when-needed' | 'hands-off';
export const MODES: Mode[] = ['ask-when-needed', 'hands-off'];

export interface Settings {
  locale: Locale;
  model: ModelSettings | null;
  project: string | null;
  mode: Mode;
}

export type Actor = 'rocky' | 'subagent' | 'opencode' | 'user';

export type Effect =
  | { kind: 'read'; path: string; secret?: true }
  | {
      kind: 'write';
      path: string;
      operation: 'create' | 'edit' | 'delete';
      content?: string;
      encoding?: 'base64';
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
  | { kind: 'plan'; title: string; options: PlanOption[] };

export interface PlanOption {
  title: string;
  summary: string;
  steps: string[];
}

export interface PendingApproval {
  id: string;
  threadId: string;
  toolCallId: string | null;
  actor: Actor;
  effect: Effect;
  contentHash: string;
  reason: string;
  detail: string | null;
  before: string | null;
  root: string | null;
  /** What "allow for this conversation" would allow (a category). */
  grant: string | null;
  /** Commands only: the rule "always allow" would save. */
  always: string[] | null;
  createdAt: number;
}

export type Outcome =
  'pending' | 'succeeded' | 'failed' | 'unknown' | 'not-run';

export interface Receipt {
  id: string;
  threadId: string | null;
  runId: string | null;
  toolCallId: string | null;
  actor: Actor;
  effect: Effect;
  contentHash: string;
  decision: 'allowed' | 'approved' | 'rejected' | 'denied';
  reason: string;
  outcome: Outcome;
  detail: string | null;
  createdAt: number;
}

export interface FileChange {
  path: string;
  created: boolean;
  deleted: boolean;
  before: string | null;
  after: string | null;
  tooLarge: boolean;
  /** One of the six document formats: a layout preview is available. */
  document: boolean;
  modifiedSince: boolean;
  contentHash: string;
}

/** A path inside the project shown relative to it, with forward slashes. */
export function displayPath(path: string, project: string | null): string {
  if (!project) return path;
  const norm = (p: string) => p.replace(/\\/g, '/');
  const root = norm(project).replace(/\/+$/, '');
  const full = norm(path);
  const inside =
    full.toLowerCase().startsWith(`${root.toLowerCase()}/`) ||
    full.toLowerCase() === root.toLowerCase();
  return inside ? full.slice(root.length + 1) || '.' : full;
}

export type JobStatus =
  | 'queued'
  | 'running'
  | 'verified'
  | 'problems'
  | 'failed'
  | 'stopped'
  | 'interrupted'
  | 'applied'
  | 'discarded';

export interface JobResult {
  stopReason: string | null;
  summary: string;
  changed: string[];
  unapproved: string[];
  mismatched: string[];
  diff: string;
  checks: { argv: string[]; exitCode: number | null; output: string }[];
  warnings: string[];
  error?: string;
}

export interface Job {
  id: string;
  threadId: string;
  agent: string;
  title: string;
  task: string;
  status: JobStatus;
  worktree: string | null;
  branch: string | null;
  result: JobResult | null;
  createdAt: number;
  finishedAt: number | null;
  /** In the list: place in the queue (0 = running), and approvals waiting for the user. */
  position?: number | null;
  waiting?: number;
}

export type JobEvent = { at: number } & (
  | { type: 'message' | 'prompt' | 'status'; text: string }
  | { type: 'tool'; id: string; title: string; kind: string; status: string }
  | {
      type: 'permission';
      id: string;
      title: string;
      decision: 'allow' | 'reject';
      receiptId: string | null;
    }
);

export interface ApplyItem {
  path: string;
  operation: 'create' | 'edit' | 'delete';
  contentHash: string;
  modifiedSince: boolean;
  before: string | null;
  after: string | null;
}
