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

export type Mode = 'ask-always' | 'ask-when-needed' | 'hands-off';
export const MODES: Mode[] = ['ask-always', 'ask-when-needed', 'hands-off'];

export interface Settings {
  locale: Locale;
  model: ModelSettings | null;
  project: string | null;
  mode: Mode;
}

export type Actor = 'rocky' | 'subagent' | 'opencode' | 'user';

export type Effect =
  | { kind: 'read'; path: string }
  | {
      kind: 'write';
      path: string;
      operation: 'create' | 'edit' | 'delete';
      content?: string;
    }
  | { kind: 'command'; argv: string[]; cwd: string }
  | { kind: 'mcp'; server: string; tool: string; args: unknown }
  | { kind: 'network'; method: string; url: string };

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
