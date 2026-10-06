// A document change shown two ways: the Markdown diff, or how the document looks (before or
// after). The layout comes from the server as one self-contained page, shown in a sandboxed
// frame: no scripts, no network, no popups.
import { useEffect, useState, type ReactNode } from 'react';
import { api } from '../api.ts';
import { useI18n } from '../i18n/index.tsx';

/** Paths Rocky can draw a layout preview for (the six document formats). */
export const isDocument = (path: string) =>
  /\.(pdf|docx|xlsx|pptx|md|markdown|html?)$/i.test(path);

type Side = 'before' | 'after';
type Loaded =
  | { state: 'loading' }
  | { state: 'ready'; html: string | null; truncated: boolean }
  | { state: 'error'; error: string };

function Layout({
  url,
  hasBefore,
  hasAfter,
}: {
  url: string;
  hasBefore: boolean;
  hasAfter: boolean;
}) {
  const { t } = useI18n();
  const [side, setSide] = useState<Side>(hasAfter ? 'after' : 'before');
  const [loaded, setLoaded] = useState<Loaded>({ state: 'loading' });

  useEffect(() => {
    let active = true;
    setLoaded({ state: 'loading' });
    api<{ html: string | null; truncated: boolean }>(
      `${url}${url.includes('?') ? '&' : '?'}side=${side}`,
    )
      .then((r) => {
        if (active) setLoaded({ state: 'ready', ...r });
      })
      .catch((e: unknown) => {
        if (active)
          setLoaded({
            state: 'error',
            error: e instanceof Error ? e.message : '',
          });
      });
    return () => {
      active = false;
    };
  }, [url, side]);

  return (
    <div className="doc-layout">
      {hasBefore && hasAfter && (
        <div className="segmented" role="group" aria-label={t('preview.side')}>
          {(['before', 'after'] as const).map((s) => (
            <button
              key={s}
              type="button"
              className={side === s ? 'selected' : ''}
              aria-pressed={side === s}
              onClick={() => setSide(s)}
            >
              {t(`preview.${s}`)}
            </button>
          ))}
        </div>
      )}
      {loaded.state === 'loading' ? (
        <p className="small muted">{t('preview.loading')}</p>
      ) : loaded.state === 'error' ? (
        <p className="error small" role="alert">
          {t('preview.error', { error: loaded.error })}
        </p>
      ) : loaded.html === null ? (
        <p className="small muted">{t('preview.missing')}</p>
      ) : (
        <>
          {loaded.truncated && (
            <p className="small muted">{t('preview.truncated')}</p>
          )}
          <iframe
            className="doc-frame"
            title={t(`preview.frame.${side}`)}
            sandbox=""
            srcDoc={loaded.html}
          />
        </>
      )}
    </div>
  );
}

export function DocumentChange({
  diff,
  url,
  hasBefore,
  hasAfter,
}: {
  /** The text diff, shown first. */
  diff: ReactNode;
  /** The preview endpoint (without the side). */
  url: string;
  hasBefore: boolean;
  hasAfter: boolean;
}) {
  const { t } = useI18n();
  const [view, setView] = useState<'text' | 'layout'>('text');
  return (
    <div className="doc-change">
      <div className="segmented" role="group" aria-label={t('preview.view')}>
        {(['text', 'layout'] as const).map((v) => (
          <button
            key={v}
            type="button"
            className={view === v ? 'selected' : ''}
            aria-pressed={view === v}
            onClick={() => setView(v)}
          >
            {t(`preview.${v}`)}
          </button>
        ))}
      </div>
      {view === 'text' ? (
        diff
      ) : (
        <Layout url={url} hasBefore={hasBefore} hasAfter={hasAfter} />
      )}
    </div>
  );
}
