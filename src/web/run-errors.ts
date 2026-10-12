// What the chat says when a run never reached the server or the server refused it
// (ADR 0030). The run request itself fails; no RUN_ERROR event arrives.
import type { MessageKey } from './i18n/index.tsx';

export function runFailure(error: unknown): {
  key: MessageKey;
  params?: Record<string, string>;
} {
  const status = (error as { status?: unknown } | null)?.status;
  if (status === 413) return { key: 'chat.error.too-long' };
  return {
    key: 'chat.error',
    params: { error: error instanceof Error ? error.message : String(error) },
  };
}
