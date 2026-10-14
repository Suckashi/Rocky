// One tool call in the transcript: what it did, its state, and its result on demand.
import {
  Check,
  ChevronRight,
  CircleSlash,
  Hourglass,
  LoaderCircle,
} from 'lucide-react';
import { useState } from 'react';
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
    const value = args[key];
    if (typeof value !== 'string') continue;
    // File tools see the project folder as "/"; show the path the way the user knows it.
    return key === 'file_path' || key === 'path'
      ? value.replace(/^\/+/, '') || '/'
      : value;
  }
  return '';
}

/** A tool call in a few words, for Roko's status while the call runs ("讀取檔案：app.js"). */
export function toolSummary(
  name: string,
  args: string,
  t: (key: MessageKey, params?: Record<string, string | number>) => string,
): string {
  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(args || '{}') as Record<string, unknown>;
  } catch {
    // Arguments still streaming in: the label alone.
  }
  const label = KNOWN.has(name)
    ? t(`tool.${name}` as MessageKey)
    : t('tool.other', { name });
  // A command by its program's name, not its full path; a long line is cut short.
  const argv = Array.isArray(parsed['argv'])
    ? parsed['argv'].map(String)
    : null;
  const full = argv
    ? commandLine([
        (argv[0] ?? '').split(/[\\/]/).pop() ?? '',
        ...argv.slice(1),
      ])
    : target(parsed);
  const what = full.length > 48 ? `${full.slice(0, 47)}…` : full;
  return what ? t('tool.summary', { label, target: what }) : label;
}

/** Tools that only look: Roko reads (the sheet's "review" row) instead of running. */
export const LOOKING = new Set([
  'ls',
  'read_file',
  'glob',
  'grep',
  'read_document',
  'search_memory',
  'load_skill',
]);

export type ToolState = 'running' | 'waiting' | 'done' | 'interrupted';

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
  const [open, setOpen] = useState(false);
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
    state === 'waiting' ? (
      <Hourglass size={14} />
    ) : state === 'running' ? (
      <LoaderCircle size={14} className="spin" />
    ) : state === 'done' ? (
      <Check size={14} />
    ) : (
      <CircleSlash size={14} />
    );
  const head = (
    <>
      <span className="tool-icon" role="img" aria-label={t(`tool.${state}`)}>
        {icon}
      </span>
      <span className="tool-name">{label}</span>
      <span className="tool-target mono">{target(parsed)}</span>
      {state === 'interrupted' && (
        <span className="badge warn">{t('tool.interrupted')}</span>
      )}
    </>
  );
  return (
    <div className={`tool-card ${state}${open ? ' open' : ''}`}>
      <div className="tool-head">
        {result !== undefined ? (
          <button
            type="button"
            className="tool-toggle"
            aria-expanded={open}
            onClick={() => setOpen((o) => !o)}
          >
            {head}
            <ChevronRight size={14} className="tool-chevron" aria-hidden />
          </button>
        ) : (
          <div className="tool-toggle">{head}</div>
        )}
        {file && (
          <button
            type="button"
            className="link small"
            onClick={() => openPreview(filePreview(file))}
          >
            {t('preview.open')}
          </button>
        )}
        {jobId && (
          <a className="link small" href={`#/jobs/${jobId}`}>
            {t('jobs.view')}
          </a>
        )}
      </div>
      {open && result !== undefined && (
        <div className="tool-result">
          <span className="label">{t('tool.output')}</span>
          <pre className="code">
            {result.length > RESULT_LIMIT
              ? `${result.slice(0, RESULT_LIMIT)}…`
              : result}
          </pre>
        </div>
      )}
    </div>
  );
}
