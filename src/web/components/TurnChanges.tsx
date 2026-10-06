// "N files changed this turn [View] [Restore all]". Restoring shows the plan first; the
// confirmation is bound to the content the user saw, and the server checks it again.
import { useState } from 'react';
import { api, ApiError, displayPath, type FileChange } from '../api.ts';
import { useI18n, type MessageKey } from '../i18n/index.tsx';
import { Diff } from './Diff.tsx';
import { DocumentChange } from './DocumentPreview.tsx';

export function TurnChanges({
  threadId,
  runId,
  count,
  project,
  onRestored,
}: {
  threadId: string;
  runId: string;
  count: number;
  project: string | null;
  onRestored: () => void;
}) {
  const { t } = useI18n();
  const [changes, setChanges] = useState<FileChange[] | null>(null);
  const [view, setView] = useState<'closed' | 'diff' | 'confirm'>('closed');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const base = `/threads/${threadId}/runs/${encodeURIComponent(runId)}`;

  const open = async (next: 'diff' | 'confirm') => {
    if (view === next) {
      setView('closed');
      return;
    }
    setMessage('');
    setBusy(true);
    try {
      const body = await api<{ changes: FileChange[] }>(`${base}/changes`);
      setChanges(body.changes);
      setView(next);
    } catch (e) {
      setMessage(
        t('changes.error', { error: e instanceof Error ? e.message : '' }),
      );
    } finally {
      setBusy(false);
    }
  };

  const restore = async () => {
    if (!changes) return;
    setBusy(true);
    try {
      const result = await api<{ restored: string[] }>(
        `${base}/restore`,
        'POST',
        {
          items: changes.map((c) => ({
            path: c.path,
            contentHash: c.contentHash,
          })),
        },
      );
      setMessage(t('changes.restored', { count: result.restored.length }));
      setView('closed');
      onRestored();
    } catch (e) {
      const code = e instanceof Error ? e.message : '';
      setMessage(
        e instanceof ApiError &&
          (code === 'content-changed' || code === 'denied')
          ? t(`changes.error.${code}` as MessageKey, { path: '' })
          : t('changes.error', { error: code }),
      );
      setView('closed');
    } finally {
      setBusy(false);
    }
  };

  const kind = (c: FileChange) =>
    t(
      c.created
        ? 'changes.created'
        : c.deleted
          ? 'changes.deleted'
          : 'changes.edited',
    );

  return (
    <div className="turn-changes">
      <div className="row">
        <span>{t('changes.summary', { count })}</span>
        <span className="spacer" />
        <button
          type="button"
          className="secondary"
          disabled={busy}
          onClick={() => void open('diff')}
        >
          {t(view === 'diff' ? 'changes.hide' : 'changes.view')}
        </button>
        <button
          type="button"
          className="secondary"
          disabled={busy}
          onClick={() => void open('confirm')}
        >
          {t('changes.restoreAll')}
        </button>
      </div>
      {busy && <p className="small muted">{t('changes.loading')}</p>}
      {view !== 'closed' && changes && (
        <div className="change-list">
          {view === 'confirm' && <strong>{t('changes.confirmTitle')}</strong>}
          {changes.map((c) => (
            <div key={c.path} className="change">
              <div className="row">
                <span className="badge">{kind(c)}</span>
                <span className="mono small">
                  {displayPath(c.path, project)}
                </span>
              </div>
              {c.modifiedSince && (
                <p className="warn small" role="note">
                  {t('changes.modifiedSince')}
                </p>
              )}
              {view === 'diff' &&
                (c.document ? (
                  <DocumentChange
                    diff={
                      c.tooLarge ? (
                        <p className="small muted">{t('diff.tooLarge')}</p>
                      ) : (
                        <Diff before={c.before} after={c.after} />
                      )
                    }
                    url={`${base}/preview?path=${encodeURIComponent(c.path)}`}
                    hasBefore={!c.created}
                    hasAfter={!c.deleted}
                  />
                ) : c.tooLarge ? (
                  <p className="small muted">{t('diff.tooLarge')}</p>
                ) : (
                  <Diff before={c.before} after={c.after} />
                ))}
            </div>
          ))}
          {view === 'confirm' && (
            <div className="row end">
              <button
                type="button"
                className="secondary"
                onClick={() => setView('closed')}
              >
                {t('changes.cancel')}
              </button>
              <button
                type="button"
                className="primary"
                disabled={busy}
                onClick={() => void restore()}
              >
                {t('changes.confirm')}
              </button>
            </div>
          )}
        </div>
      )}
      {message && (
        <p className="small" role="status">
          {message}
        </p>
      )}
    </div>
  );
}
