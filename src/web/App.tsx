// The shell: rail, conversation list, chat and Roko's panel, or onboarding/settings/locked.
import { CopilotKitProvider } from '@copilotkit/react-core/v2';
import {
  Briefcase,
  MessageSquare,
  Settings as SettingsIcon,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError, type Settings } from './api.ts';
import { Chat } from './components/Chat.tsx';
import { usePreviewPane } from './components/PreviewPane.tsx';
import { Roko, type RokoState } from './components/Roko.tsx';
import { ThreadList } from './components/ThreadList.tsx';
import { I18nProvider, useI18n } from './i18n/index.tsx';
import { Locked } from './pages/Locked.tsx';
import { JobsPage } from './pages/JobsPage.tsx';
import { Onboarding } from './pages/Onboarding.tsx';
import { SettingsPage } from './pages/SettingsPage.tsx';

type View = 'chat' | 'jobs' | 'settings' | 'onboarding';

const threadFromHash = () => /^#\/t\/([\w-]+)$/.exec(window.location.hash)?.[1];
const jobFromHash = () => /^#\/jobs(?:\/([\w-]+))?$/.exec(window.location.hash);

/**
 * Approvals background jobs are waiting for. Polled (jobs run outside any chat stream); a
 * browser notification goes out when the count rises while the window is in the background.
 */
function useJobsWaiting(): number {
  const { t } = useI18n();
  const [waiting, setWaiting] = useState(0);
  const last = useRef(0);
  useEffect(() => {
    let active = true;
    const poll = () =>
      void api<{ waiting: number }>('/jobs/summary')
        .then((s) => {
          if (!active) return;
          if (
            s.waiting > last.current &&
            document.hidden &&
            'Notification' in window &&
            Notification.permission === 'granted'
          )
            new Notification(t('jobs.notify'));
          last.current = s.waiting;
          setWaiting(s.waiting);
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
  const [threadId, setThreadId] = useState(
    () => threadFromHash() ?? crypto.randomUUID(),
  );
  const [refreshKey, setRefreshKey] = useState(0);
  const [roko, setRoko] = useState<RokoState>('idle');
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

  if (view === 'onboarding') {
    return (
      <Onboarding
        settings={settings}
        onChange={setSettings}
        onDone={() => setView('chat')}
      />
    );
  }
  if (view === 'settings') {
    return (
      <SettingsPage
        settings={settings}
        onChange={setSettings}
        onBack={() => setView('chat')}
      />
    );
  }
  return preview.provider(
    <div
      className={`shell${view === 'jobs' ? ' jobs-view' : ''}${preview.open ? ' previewing' : ''}`}
    >
      <nav className="rail" aria-label={t('app.name')}>
        <img src="/rocky/mark.svg" alt={t('app.name')} width={28} height={28} />
        <button
          type="button"
          className={`icon-button${view === 'chat' ? ' active' : ''}`}
          aria-label={t('nav.chat')}
          aria-current={view === 'chat' ? 'page' : undefined}
          onClick={() => setView('chat')}
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
          aria-current={view === 'jobs' ? 'page' : undefined}
          onClick={() => setView('jobs')}
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
          className="icon-button bottom"
          aria-label={t('nav.settings')}
          onClick={() => setView('settings')}
        >
          <SettingsIcon size={18} />
        </button>
      </nav>
      {view === 'jobs' ? (
        <JobsPage
          selected={jobId}
          project={settings.project}
          onSelect={setJobId}
        />
      ) : (
        <>
          <ThreadList
            selected={threadId}
            onSelect={setThreadId}
            onNew={() => setThreadId(crypto.randomUUID())}
            refreshKey={refreshKey}
          />
          <Chat
            key={threadId}
            threadId={threadId}
            project={settings.project}
            onActivity={onActivity}
            onState={setRoko}
          />
        </>
      )}
      {preview.pane}
      <aside className="panel">
        <div className={`presence ${roko}`}>
          <Roko state={roko} size={128} />
          <strong>
            {t(
              roko === 'waiting'
                ? 'panel.waiting'
                : roko === 'done'
                  ? 'panel.done'
                  : roko === 'running'
                    ? 'panel.running'
                    : roko === 'failed'
                      ? 'panel.failed'
                      : 'panel.idle',
            )}
          </strong>
        </div>
        <div className="panel-section">
          <span className="label">{t('panel.project')}</span>
          {settings.project ? (
            <span className="mono small">{settings.project}</span>
          ) : (
            <button
              type="button"
              className="link"
              onClick={() => setView('settings')}
            >
              {t('project.none')}
            </button>
          )}
        </div>
        <div className="panel-section">
          <span className="label">{t('panel.model')}</span>
          {settings.model ? (
            <span className="mono small">{settings.model.model}</span>
          ) : (
            <button
              type="button"
              className="link"
              onClick={() => setView('settings')}
            >
              {t('model.notConfigured')}
            </button>
          )}
        </div>
      </aside>
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
    if (settings)
      document.documentElement.lang =
        settings.locale === 'zh-TW' ? 'zh-Hant' : 'en';
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
