// The shell: rail, conversation list, chat and Roko's panel, or onboarding/settings/locked.
import { CopilotKitProvider } from '@copilotkit/react-core/v2';
import {
  Briefcase,
  MessageSquare,
  PanelLeft,
  Settings as SettingsIcon,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError, type Settings } from './api.ts';
import { Chat } from './components/Chat.tsx';
import { usePreviewPane } from './components/PreviewPane.tsx';
import { Roko } from './components/Roko.tsx';
import { ThreadList } from './components/ThreadList.tsx';
import { I18nProvider, useI18n, type MessageKey } from './i18n/index.tsx';
import { isEditable } from './keys.ts';
import { applyTheme } from './components/ThemeSwitch.tsx';
import { Locked } from './pages/Locked.tsx';
import { JobsPage } from './pages/JobsPage.tsx';
import { Onboarding } from './pages/Onboarding.tsx';
import { SettingsPage } from './pages/SettingsPage.tsx';

type View = 'chat' | 'jobs' | 'settings' | 'onboarding';

const threadFromHash = () => /^#\/t\/([\w-]+)$/.exec(window.location.hash)?.[1];
/** "#/jobs", "#/jobs/<id>", or "#/jobs/<id>/apply" (from a job card's Apply). */
const jobFromHash = () =>
  /^#\/jobs(?:\/([\w-]+)(\/apply)?)?$/.exec(window.location.hash);

/**
 * Approvals background jobs are waiting for. Polled (jobs run outside any chat stream); a
 * browser notification goes out when the count rises while the window is in the background.
 */
function useJobsWaiting(): number {
  const { t } = useI18n();
  const [waiting, setWaiting] = useState(0);
  const last = useRef(0);
  /** Finished jobs already seen; undefined until the first answer (old jobs never notify). */
  const seen = useRef<Set<string> | undefined>(undefined);
  useEffect(() => {
    let active = true;
    const notify = (text: string) => {
      if (
        document.hidden &&
        'Notification' in window &&
        Notification.permission === 'granted'
      )
        new Notification(text);
    };
    const poll = () =>
      void api<{
        waiting: number;
        finished: { id: string; title: string; status: string }[];
      }>('/jobs/summary')
        .then((s) => {
          if (!active) return;
          if (s.waiting > last.current) notify(t('jobs.notify'));
          last.current = s.waiting;
          setWaiting(s.waiting);
          for (const job of s.finished) {
            if (seen.current && !seen.current.has(job.id))
              notify(
                t('jobs.notifyDone', {
                  title: job.title,
                  status: t(`jobs.status.${job.status}` as MessageKey),
                }),
              );
          }
          seen.current = new Set([
            ...(seen.current ?? []),
            ...s.finished.map((j) => j.id),
          ]);
        })
        .catch(() => undefined);
    poll();
    const timer = setInterval(poll, 3000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [t]);
  return waiting;
}

function Shell({
  settings,
  setSettings,
}: {
  settings: Settings;
  setSettings: (s: Settings) => void;
}) {
  const { t } = useI18n();
  const [view, setView] = useState<View>(
    !settings.model ? 'onboarding' : jobFromHash() ? 'jobs' : 'chat',
  );
  const [jobId, setJobId] = useState(() => jobFromHash()?.[1]);
  const [applyJob, setApplyJob] = useState(() => !!jobFromHash()?.[2]);
  const [threadId, setThreadId] = useState(
    () => threadFromHash() ?? crypto.randomUUID(),
  );
  const [refreshKey, setRefreshKey] = useState(0);
  /** Narrow windows fold the conversation list into a drawer opened from the rail. */
  const [threadsOpen, setThreadsOpen] = useState(false);
  const jobsWaiting = useJobsWaiting();
  const preview = usePreviewPane();

  // The hash Rocky itself wrote; only other changes (links, back/forward) navigate.
  const written = useRef('');
  useEffect(() => {
    if (view !== 'chat' && view !== 'jobs') return;
    written.current = `#${view === 'jobs' ? (jobId ? `/jobs/${jobId}` : '/jobs') : `/t/${threadId}`}`;
    window.location.hash = written.current;
  }, [threadId, view, jobId]);

  // Links inside the page (a job from a tool card, a conversation from a job) use the hash.
  useEffect(() => {
    const onHash = () => {
      if (window.location.hash === written.current) return;
      const job = jobFromHash();
      const thread = threadFromHash();
      if (job) {
        setJobId(job[1]);
        setApplyJob(!!job[2]);
        setView('jobs');
      } else if (thread) {
        setThreadId(thread);
        setView('chat');
      }
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const onActivity = useCallback(() => setRefreshKey((k) => k + 1), []);

  useEffect(() => {
    if (!threadsOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setThreadsOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [threadsOpen]);
  const openThread = (id: string) => {
    setThreadId(id);
    setThreadsOpen(false);
  };

  // Keyboard: Ctrl/⌘+Shift+O starts a conversation; "/" outside a field goes to the input box.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.isComposing) return;
      if (
        (e.ctrlKey || e.metaKey) &&
        e.shiftKey &&
        e.key.toLowerCase() === 'o'
      ) {
        e.preventDefault();
        setView('chat');
        setThreadId(crypto.randomUUID());
        setThreadsOpen(false);
        return;
      }
      if (
        e.key === '/' &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey &&
        !isEditable(e.target)
      ) {
        const box =
          document.querySelector<HTMLTextAreaElement>('.composer textarea');
        if (!box) return;
        e.preventDefault();
        box.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (view === 'onboarding') {
    return (
      <Onboarding
        settings={settings}
        onChange={setSettings}
        onDone={() => setView('chat')}
      />
    );
  }
  return preview.provider(
    <div
      className={`shell${view === 'jobs' ? ' jobs-view' : ''}${view === 'settings' ? ' settings-view' : ''}${preview.open ? ' previewing' : ''}${threadsOpen ? ' threads-open' : ''}`}
    >
      <nav className="rail" aria-label={t('app.name')}>
        <img src="/rocky/mark.svg" alt={t('app.name')} width={28} height={28} />
        {view !== 'settings' && (
          <button
            type="button"
            className="icon-button threads-toggle"
            aria-label={t(view === 'jobs' ? 'jobs.title' : 'nav.threads')}
            aria-expanded={threadsOpen}
            onClick={() => setThreadsOpen((open) => !open)}
          >
            <PanelLeft size={18} />
          </button>
        )}
        <button
          type="button"
          className={`icon-button${view === 'chat' ? ' active' : ''}`}
          aria-label={t('nav.chat')}
          title={t('nav.chat')}
          aria-current={view === 'chat' ? 'page' : undefined}
          onClick={() => {
            setView('chat');
            setThreadsOpen(false);
          }}
        >
          <MessageSquare size={18} />
        </button>
        <button
          type="button"
          className={`icon-button${view === 'jobs' ? ' active' : ''}`}
          aria-label={
            jobsWaiting
              ? t('nav.jobsWaiting', { count: jobsWaiting })
              : t('nav.jobs')
          }
          title={t('nav.jobs')}
          aria-current={view === 'jobs' ? 'page' : undefined}
          onClick={() => {
            setView('jobs');
            setThreadsOpen(false);
          }}
        >
          <Briefcase size={18} />
          {jobsWaiting > 0 && (
            <span className="rail-badge" aria-hidden="true">
              {jobsWaiting}
            </span>
          )}
        </button>
        <button
          type="button"
          className={`icon-button bottom${view === 'settings' ? ' active' : ''}`}
          aria-current={view === 'settings' ? 'page' : undefined}
          aria-label={t('nav.settings')}
          title={t('nav.settings')}
          onClick={() => setView('settings')}
        >
          <SettingsIcon size={18} />
        </button>
      </nav>
      {view === 'settings' ? (
        <SettingsPage
          settings={settings}
          onChange={setSettings}
          onBack={() => setView('chat')}
        />
      ) : view === 'jobs' ? (
        <JobsPage
          selected={jobId}
          project={settings.project}
          autoApply={applyJob}
          onSelect={(id) => {
            setApplyJob(false);
            setJobId(id);
            setThreadsOpen(false);
          }}
        />
      ) : (
        <>
          <ThreadList
            selected={threadId}
            onSelect={openThread}
            onNew={() => openThread(crypto.randomUUID())}
            refreshKey={refreshKey}
            onClose={() => setThreadsOpen(false)}
          />
          <Chat
            key={threadId}
            threadId={threadId}
            project={settings.project}
            mode={settings.mode}
            model={settings.model?.model ?? null}
            onActivity={onActivity}
            onSettings={setSettings}
            onOpenSettings={() => setView('settings')}
          />
        </>
      )}
      <button
        type="button"
        className="threads-backdrop"
        tabIndex={-1}
        aria-label={t('nav.threadsClose')}
        onClick={() => setThreadsOpen(false)}
      />
      {preview.pane}
    </div>,
  );
}

export function App() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [locked, setLocked] = useState(false);
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    api<Settings>('/settings')
      .then(setSettings)
      .catch((e: unknown) => {
        if (e instanceof ApiError && e.status === 401) setLocked(true);
        else setOffline(true);
      });
  }, []);

  useEffect(() => {
    if (!settings) return;
    document.documentElement.lang =
      settings.locale === 'zh-TW' ? 'zh-Hant' : 'en';
    applyTheme(settings.theme);
  }, [settings]);

  const locale = settings?.locale ?? 'zh-TW';
  return (
    <I18nProvider locale={locale}>
      {locked ? (
        <Locked />
      ) : offline ? (
        <Offline />
      ) : settings ? (
        <CopilotKitProvider runtimeUrl="/api/copilotkit">
          <Shell settings={settings} setSettings={setSettings} />
        </CopilotKitProvider>
      ) : null}
    </I18nProvider>
  );
}

function Offline() {
  const { t } = useI18n();
  return (
    <main className="centered">
      <Roko state="failed" size={140} />
      <p>{t('error.network')}</p>
    </main>
  );
}
