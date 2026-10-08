// The preview side panel, beside the conversation (after DeepSeek Harness's web preview
// panel: open from links, file names and change cards; drag its edge to resize). Each version
// is a self-contained page from the server in a sandboxed frame: no scripts, no network.
import { X } from 'lucide-react';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { api, ApiError } from '../api.ts';
import { useI18n } from '../i18n/index.tsx';
import { Roko } from './Roko.tsx';

export interface PreviewTarget {
  /** Shown in the panel header (a project-relative path). */
  title: string;
  /** The preview endpoint, without the side. */
  url: string;
  hasBefore: boolean;
  hasAfter: boolean;
}

const PreviewContext = createContext<(target: PreviewTarget) => void>(
  () => undefined,
);
export const useOpenPreview = () => useContext(PreviewContext);

/** Files the panel can show: the six document formats, pictures, and (via the server) text. */
export const isDocument = (path: string) =>
  /\.(pdf|docx|xlsx|pptx|md|markdown|html?)$/i.test(path);
export const isPreviewable = (path: string) =>
  isDocument(path) || /\.(png|jpe?g|gif|webp|svg)$/i.test(path);

/** Opens a project file (as Rocky's tools name it) in the panel. */
export const filePreview = (path: string): PreviewTarget => ({
  title: path.replace(/^\//, ''),
  url: `/files/preview?path=${encodeURIComponent(path)}`,
  hasBefore: false,
  hasAfter: true,
});

type Side = 'before' | 'after';
type Loaded =
  | { state: 'loading' }
  | { state: 'ready'; html: string | null; truncated: boolean }
  | { state: 'error'; error: string };

function Version({ url, side }: { url: string; side: Side }) {
  const { t } = useI18n();
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
        if (!active) return;
        const code = e instanceof Error ? e.message : '';
        setLoaded({
          state: 'error',
          error:
            e instanceof ApiError && e.status === 404
              ? t('preview.gone')
              : e instanceof ApiError && e.status === 415
                ? t('preview.unsupported')
                : code,
        });
      });
    return () => {
      active = false;
    };
  }, [url, side, t]);
  if (loaded.state === 'loading')
    return <p className="small muted">{t('preview.loading')}</p>;
  if (loaded.state === 'error')
    return (
      <p className="error small" role="alert">
        {t('preview.error', { error: loaded.error })}
      </p>
    );
  if (loaded.html === null)
    return <p className="small muted">{t('preview.missing')}</p>;
  return (
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
  );
}

const WIDTH_KEY = 'rocky.previewWidth';
const MIN_WIDTH = 320;

function savedWidth(): number {
  try {
    const n = Number(localStorage.getItem(WIDTH_KEY));
    if (n >= MIN_WIDTH) return n;
  } catch {
    // Storage may be unavailable; the default width is fine.
  }
  return 520;
}

function Pane({
  target,
  onClose,
}: {
  target: PreviewTarget;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const both = target.hasBefore && target.hasAfter;
  const [view, setView] = useState<Side | 'both'>(
    target.hasAfter ? 'after' : 'before',
  );
  const [width, setWidth] = useState(savedWidth);
  const dragging = useRef(false);

  // A new file starts on its newest version.
  useEffect(() => {
    setView(target.hasAfter ? 'after' : 'before');
  }, [target]);

  const startDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    dragging.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const drag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    const max = Math.max(MIN_WIDTH, window.innerWidth * 0.7);
    setWidth(
      Math.round(
        Math.min(max, Math.max(MIN_WIDTH, window.innerWidth - event.clientX)),
      ),
    );
  };
  const endDrag = () => {
    if (!dragging.current) return;
    dragging.current = false;
    try {
      localStorage.setItem(WIDTH_KEY, String(width));
    } catch {
      // Not remembered; nothing else depends on it.
    }
  };
  const resizeByKey = (event: React.KeyboardEvent) => {
    const step =
      event.key === 'ArrowLeft' ? 40 : event.key === 'ArrowRight' ? -40 : 0;
    if (!step) return;
    event.preventDefault();
    event.stopPropagation();
    setWidth((w) =>
      Math.max(MIN_WIDTH, Math.min(window.innerWidth * 0.7, w + step)),
    );
  };

  return (
    <aside
      className="preview-pane"
      style={{ width }}
      aria-label={t('preview.pane')}
    >
      <div
        className="preview-resize"
        role="separator"
        aria-orientation="vertical"
        aria-label={t('preview.resize')}
        aria-valuenow={width}
        tabIndex={0}
        onPointerDown={startDrag}
        onPointerMove={drag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onKeyDown={resizeByKey}
      />
      <header className="preview-head">
        <Roko state="idle" size={28} />
        <strong className="mono small" title={target.title}>
          {target.title}
        </strong>
        <button
          type="button"
          className="icon-button"
          aria-label={t('preview.close')}
          onClick={onClose}
        >
          <X size={16} />
        </button>
      </header>
      {both && (
        <div className="segmented" role="group" aria-label={t('preview.side')}>
          {(['before', 'after', 'both'] as const).map((s) => (
            <button
              key={s}
              type="button"
              className={view === s ? 'selected' : ''}
              aria-pressed={view === s}
              onClick={() => setView(s)}
            >
              {t(`preview.${s}`)}
            </button>
          ))}
        </div>
      )}
      <div className={`preview-body${view === 'both' ? ' both' : ''}`}>
        {view === 'both' ? (
          (['before', 'after'] as const).map((s) => (
            <section key={s} className="preview-version">
              <span className="label small">{t(`preview.${s}`)}</span>
              <Version url={target.url} side={s} />
            </section>
          ))
        ) : (
          <section className="preview-version">
            <Version url={target.url} side={view} />
          </section>
        )}
      </div>
    </aside>
  );
}

/** Provides "open in the panel" to everything inside, and renders the panel when open. */
export function usePreviewPane(): {
  provider: (children: ReactNode) => ReactNode;
  pane: ReactNode;
  open: boolean;
} {
  const [target, setTarget] = useState<PreviewTarget | null>(null);
  const open = useCallback((t: PreviewTarget) => setTarget(t), []);
  return {
    provider: (children) => (
      <PreviewContext.Provider value={open}>{children}</PreviewContext.Provider>
    ),
    pane: target ? (
      <Pane target={target} onClose={() => setTarget(null)} />
    ) : null,
    open: target !== null,
  };
}
