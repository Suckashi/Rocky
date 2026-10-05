// Replaces the input box while Rocky waits for a decision. One question at a time, in order.
import { Maximize2, Minimize2, Square } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { displayPath, type PendingApproval } from '../api.ts';
import { useI18n, type MessageKey } from '../i18n/index.tsx';
import { Diff } from './Diff.tsx';

export type Answer =
  | { decision: 'allow-once' | 'allow-session' }
  | { decision: 'reject'; reason?: string };

const OPTIONS = [
  'approval.allowOnce',
  'approval.allowSession',
  'approval.reject',
  'approval.rejectWithReason',
] as const satisfies readonly MessageKey[];

function Title({
  approval,
  project,
}: {
  approval: PendingApproval;
  project: string | null;
}) {
  const { t } = useI18n();
  const actor = t(`approval.actor.${approval.actor}`);
  const effect = approval.effect;
  switch (effect.kind) {
    case 'read':
      return (
        <>
          {t('approval.title.read', {
            actor,
            path: displayPath(effect.path, project),
          })}
        </>
      );
    case 'write':
      return (
        <>
          {t(`approval.title.${effect.operation}`, {
            actor,
            path: displayPath(effect.path, project),
          })}
        </>
      );
    case 'command':
      return <>{t('approval.title.command', { actor })}</>;
    case 'mcp':
      return (
        <>
          {t('approval.title.mcp', {
            actor,
            server: effect.server,
            tool: effect.tool,
          })}
        </>
      );
    case 'network':
      return <>{t('approval.title.network', { actor, url: effect.url })}</>;
  }
}

function Preview({
  approval,
  project,
}: {
  approval: PendingApproval;
  project: string | null;
}) {
  const { t } = useI18n();
  const effect = approval.effect;
  if (effect.kind === 'command') {
    return (
      <div className="approval-preview">
        <span className="label">{t('approval.argv')}</span>
        <ol className="argv mono">
          {effect.argv.map((arg, index) => (
            <li key={index}>{arg}</li>
          ))}
        </ol>
        <span className="small muted">
          {t('approval.cwd', { cwd: displayPath(effect.cwd, project) })}
        </span>
      </div>
    );
  }
  if (effect.kind === 'write') {
    return (
      <div className="approval-preview">
        <Diff
          before={approval.before}
          after={effect.operation === 'delete' ? null : (effect.content ?? '')}
        />
      </div>
    );
  }
  if (effect.kind === 'mcp') {
    return (
      <pre className="approval-preview code">
        {JSON.stringify(effect.args, null, 2)}
      </pre>
    );
  }
  return null;
}

export function ApprovalPanel({
  approvals,
  project,
  onAnswer,
  onStop,
}: {
  approvals: PendingApproval[];
  project: string | null;
  onAnswer: (approval: PendingApproval, answer: Answer) => Promise<void>;
  onStop: () => void;
}) {
  const { t } = useI18n();
  const approval = approvals[0]!;
  const [selected, setSelected] = useState(0);
  const [reason, setReason] = useState('');
  const [explaining, setExplaining] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [full, setFull] = useState(false);
  const reasonBox = useRef<HTMLInputElement>(null);
  const panel = useRef<HTMLElement>(null);

  // A new question starts fresh.
  useEffect(() => {
    setSelected(0);
    setReason('');
    setExplaining(false);
    setError('');
    panel.current?.focus();
  }, [approval.id]);

  useEffect(() => {
    if (explaining) reasonBox.current?.focus();
  }, [explaining]);

  const choose = async (index: number) => {
    if (busy) return;
    if (index === 3 && !explaining) {
      setSelected(3);
      setExplaining(true);
      return;
    }
    const answer: Answer =
      index === 0
        ? { decision: 'allow-once' }
        : index === 1
          ? { decision: 'allow-session' }
          : {
              decision: 'reject',
              ...(index === 3 && reason.trim()
                ? { reason: reason.trim() }
                : {}),
            };
    setBusy(true);
    setError('');
    try {
      await onAnswer(approval, answer);
    } catch (e) {
      setError(
        t('approval.failed', { error: e instanceof Error ? e.message : '' }),
      );
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.isComposing) return;
      if (event.key === 'e' && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        setFull((f) => !f);
        return;
      }
      const typing = event.target === reasonBox.current;
      if (event.key === 'Escape') {
        event.preventDefault();
        if (full) setFull(false);
        else if (typing) setExplaining(false);
        else void choose(2);
        return;
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        void choose(typing ? 3 : selected);
        return;
      }
      if (typing) return;
      if (/^[1-4]$/.test(event.key)) {
        event.preventDefault();
        void choose(Number(event.key) - 1);
      } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        setSelected((s) => (s + (event.key === 'ArrowDown' ? 1 : 3)) % 4);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <section
      ref={panel}
      tabIndex={-1}
      className={`approval${full ? ' fullscreen' : ''}`}
      role="region"
      aria-label={t('approval.region')}
    >
      <header className="approval-head">
        <strong>
          <Title approval={approval} project={project} />
        </strong>
        {approvals.length > 1 && (
          <span className="badge">
            {t('approval.more', { count: approvals.length - 1 })}
          </span>
        )}
        <button
          type="button"
          className="icon-button"
          aria-label={t(full ? 'approval.collapse' : 'approval.expand')}
          onClick={() => setFull((f) => !f)}
        >
          {full ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
        </button>
      </header>
      <p className="small muted">
        {t('approval.why', {
          reason: t(`approval.reason.${approval.reason}` as MessageKey),
        })}
        {approval.detail ? (
          <span className="mono"> · {approval.detail}</span>
        ) : null}
      </p>
      <Preview approval={approval} project={project} />
      <ol
        className="approval-options"
        role="listbox"
        aria-label={t('approval.region')}
      >
        {OPTIONS.map((key, index) => (
          <li key={key} role="option" aria-selected={selected === index}>
            <button
              type="button"
              className={selected === index ? 'selected' : ''}
              disabled={busy}
              onClick={() => void choose(index)}
              onMouseEnter={() => setSelected(index)}
            >
              <kbd>{index + 1}</kbd>
              {t(key)}
            </button>
            {index === 3 && explaining && (
              <input
                ref={reasonBox}
                value={reason}
                placeholder={t('approval.reasonPlaceholder')}
                aria-label={t('approval.reasonPlaceholder')}
                onChange={(e) => setReason(e.target.value)}
              />
            )}
          </li>
        ))}
      </ol>
      <footer className="approval-foot">
        <span className="small muted">
          {busy ? t('approval.sending') : t('approval.keys')}
        </span>
        {error && (
          <span className="error small" role="alert">
            {error}
          </span>
        )}
        <button
          type="button"
          className="icon-button"
          aria-label={t('chat.stop')}
          onClick={onStop}
        >
          <Square size={16} />
        </button>
      </footer>
    </section>
  );
}
