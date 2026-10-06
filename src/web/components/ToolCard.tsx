// One tool call in the transcript: what it did, its state, and its result on demand.
import { Check, CircleSlash, LoaderCircle } from 'lucide-react';
import { useI18n, type MessageKey } from '../i18n/index.tsx';
import { commandLine } from '../effects.ts';
import { filePreview, isPreviewable, useOpenPreview } from './PreviewPane.tsx';

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
  'delegate_to_opencode',
  'read_document',
  'create_document',
  'edit_document',
  'remember',
  'forget',
  'search_memory',
  'load_skill',
  'propose_plan',
]);
const RESULT_LIMIT = 4000;

function target(args: Record<string, unknown>): string {
  if (Array.isArray(args['argv'])) return commandLine(args['argv'].map(String));
  for (const key of [
    'file_path',
    'path',
    'pattern',
    'description',
    'title',
    'query',
  ]) {
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
  const openPreview = useOpenPreview();
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(args || '{}') as Record<string, unknown>;
  } catch {
    parsed = {};
  }
  const jobId =
    name === 'delegate_to_opencode' && result
      ? /Job ([\w-]{36})/.exec(result)?.[1]
      : undefined;
  // A file a tool made, changed or read can be opened in the preview panel once it is done.
  const file =
    state === 'done' &&
    /^(create_document|edit_document|read_document|write_file|edit_file|read_file)$/.test(
      name,
    ) &&
    typeof parsed['file_path'] === 'string' &&
    isPreviewable(parsed['file_path'])
      ? parsed['file_path']
      : undefined;
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
        {file && (
          <button
            type="button"
            className="link small"
            onClick={(e) => {
              e.preventDefault();
              openPreview(filePreview(file));
            }}
          >
            {t('preview.open')}
          </button>
        )}
        {jobId && (
          <a
            className="link small"
            href={`#/jobs/${jobId}`}
            onClick={(e) => e.stopPropagation()}
          >
            {t('jobs.view')}
          </a>
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
