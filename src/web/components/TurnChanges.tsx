// "N files changed this turn [View] [Restore all]". Restoring all shows the plan first; one
// file restores from its row. The request is bound to the content the user saw, and the
// server checks it again. Every restore can be undone until the next one.
import { useEffect, useRef, useState } from 'react';
import { api, ApiError, displayPath, type FileChange } from '../api.ts';
import { useI18n, type MessageKey } from '../i18n/index.tsx';
import { Diff } from './Diff.tsx';
import { DocumentChange } from './DocumentPreview.tsx';

type Item = { path: string; contentHash: string };

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
  /** What undoes the last restore (written back the way the turn left the files). */
  const [undo, setUndo] = useState<Item[] | null>(null);
  /** Files restored from their own row, so the row says so. */
  const [restoredPaths, setRestoredPaths] = useState<Set<string>>(new Set());
  const card = useRef<HTMLDivElement>(null);
  // An opened diff or confirmation scrolls fully into view instead of under the input box.
  useEffect(() => {
    if (view !== 'closed')
      card.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [view]);
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
        e instanceof ApiError && e.message === 'snapshot-damaged'
          ? t('changes.error.snapshot-damaged')
          : t('changes.error', { error: e instanceof Error ? e.message : '' }),
      );
    } finally {
      setBusy(false);
    }
  };

  const failed = (e: unknown) => {
    const code = e instanceof Error ? e.message : '';
    setMessage(
      e instanceof ApiError &&
        (code === 'content-changed' ||
          code === 'denied' ||
          code === 'snapshot-damaged')
        ? t(`changes.error.${code}` as MessageKey, { path: '' })
        : t('changes.error', { error: code }),
    );
  };

  const send = (body: { items: Item[]; partial?: boolean; target?: 'after' }) =>
    api<{ restored: string[]; undo: Item[] }>(`${base}/restore`, 'POST', body);

  /** Refreshes the list so the next restore is bound to what is on disk now. */
  const reload = async () => {
    const body = await api<{ changes: FileChange[] }>(`${base}/changes`);
    setChanges(body.changes);
  };

  const restoreOne = async (change: FileChange) => {
    if (change.contentHash === null) return;
    setBusy(true);
    try {
      const result = await send({
        items: [{ path: change.path, contentHash: change.contentHash }],
        partial: true,
      });
      setRestoredPaths((paths) => new Set(paths).add(change.path));
      setMessage(
        t('changes.restoredOne', { path: displayPath(change.path, project) }),
      );
      setUndo(result.undo);
      await reload();
      onRestored();
    } catch (e) {
      failed(e);
    } finally {
      setBusy(false);
    }
  };

  const undoRestore = async () => {
    if (!undo) return;
    setBusy(true);
    try {
      await send({ items: undo, partial: true, target: 'after' });
      setRestoredPaths(new Set());
      setUndo(null);
      setMessage(t('changes.undone'));
      if (changes) await reload();
      onRestored();
    } catch (e) {
      failed(e);
    } finally {
      setBusy(false);
    }
  };

  const restore = async () => {
    if (!changes) return;
    setBusy(true);
    try {
      const result = await send({
        // A file whose earlier version is damaged is not in the server's plan either.
        items: changes.flatMap((c) =>
          c.contentHash === null
            ? []
            : [{ path: c.path, contentHash: c.contentHash }],
        ),
      });
      setMessage(t('changes.restored', { count: result.restored.length }));
      setUndo(result.undo);
      setView('closed');
      onRestored();
    } catch (e) {
      failed(e);
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
    <div className="turn-changes" ref={card}>
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
          className="secondary danger"
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
                <span className="spacer" />
                {restoredPaths.has(c.path) ? (
                  <span className="badge status-applied">
                    {t('changes.restoredBadge')}
                  </span>
                ) : (
                  view === 'diff' &&
                  c.contentHash !== null && (
                    <button
                      type="button"
                      className="secondary danger small-button"
                      disabled={busy}
                      onClick={() => void restoreOne(c)}
                    >
                      {t('changes.restoreOne')}
                    </button>
                  )
                )}
              </div>
              {c.damaged && (
                <p className="warn small" role="note">
                  {t('changes.damaged')}
                </p>
              )}
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
                    target={{
                      title: displayPath(c.path, project),
                      url: `${base}/preview?path=${encodeURIComponent(c.path)}`,
                      hasBefore: !c.created,
                      hasAfter: !c.deleted,
                    }}
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
        <div className="row restore-status" role="status">
          <span className="small">{message}</span>
          {undo && undo.length > 0 && (
            <button
              type="button"
              className="secondary small-button"
              disabled={busy}
              onClick={() => void undoRestore()}
            >
              {t('changes.undo')}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
