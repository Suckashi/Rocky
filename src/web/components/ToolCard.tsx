// One tool call in the transcript: what it did, its state, and its result on demand.
import { Check, CircleSlash, LoaderCircle } from 'lucide-react';
import { useI18n, type MessageKey } from '../i18n/index.tsx';
import { commandLine } from '../effects.ts';

const KNOWN = new Set([
  'ls',
  'read_file',
  'write_file',
  'edit_file',
  'glob',
  'grep',
  'run_command',
  'write_todos',
  'task',
]);
const RESULT_LIMIT = 4000;

function target(args: Record<string, unknown>): string {
  if (Array.isArray(args['argv'])) return commandLine(args['argv'].map(String));
  for (const key of ['file_path', 'path', 'pattern', 'description']) {
    if (typeof args[key] === 'string') return args[key];
  }
  return '';
}

export type ToolState = 'running' | 'done' | 'interrupted';

export function ToolCard({
  name,
  args,
  result,
  state,
}: {
  name: string;
  args: string;
  result: string | undefined;
  state: ToolState;
}) {
  const { t } = useI18n();
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(args || '{}') as Record<string, unknown>;
  } catch {
    parsed = {};
  }
  const label = KNOWN.has(name)
    ? t(`tool.${name}` as MessageKey)
    : t('tool.other', { name });
  const icon =
    state === 'running' ? (
      <LoaderCircle size={14} className="spin" />
    ) : state === 'done' ? (
      <Check size={14} />
    ) : (
      <CircleSlash size={14} />
    );
  return (
    <details className={`tool-card ${state}`}>
      <summary>
        <span className="tool-icon" aria-label={t(`tool.${state}`)}>
          {icon}
        </span>
        <span className="tool-name">{label}</span>
        <span className="tool-target mono">{target(parsed)}</span>
        {state === 'interrupted' && (
          <span className="badge warn">{t('tool.interrupted')}</span>
        )}
      </summary>
      {result !== undefined && (
        <div className="tool-result">
          <span className="label">{t('tool.output')}</span>
          <pre className="code">
            {result.length > RESULT_LIMIT
              ? `${result.slice(0, RESULT_LIMIT)}…`
              : result}
          </pre>
        </div>
      )}
    </details>
  );
}
