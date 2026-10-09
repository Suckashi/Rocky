// Plain-language descriptions of actions, shared by the approval panel and receipts.
import { displayPath, type Effect } from './api.ts';
import type { Translate } from './i18n/index.tsx';

/** Shows argv the way a person would type it; items with spaces are quoted. */
export function commandLine(argv: string[]): string {
  return argv
    .map((a) => (/[\s"]/.test(a) || a === '' ? JSON.stringify(a) : a))
    .join(' ');
}

export function effectSummary(
  t: Translate,
  effect: Effect,
  project: string | null,
): string {
  switch (effect.kind) {
    case 'read':
      return t('effect.read', { path: displayPath(effect.path, project) });
    case 'write':
      return t(`effect.${effect.operation}`, {
        path: displayPath(effect.path, project),
      });
    case 'command':
      return t('effect.command', { command: commandLine(effect.argv) });
    case 'mcp':
      return t('effect.mcp', { server: effect.server, tool: effect.tool });
    case 'delegate':
      return t('effect.delegate', { title: effect.title });
    case 'plan':
      return t('effect.plan', { title: effect.title });
  }
}
