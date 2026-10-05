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

export interface Settings {
  locale: Locale;
  model: ModelSettings | null;
}
