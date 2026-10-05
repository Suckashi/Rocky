// The shell: rail, conversation list, chat and Roko's panel, or onboarding/settings/locked.
import { CopilotKitProvider } from '@copilotkit/react-core/v2';
import { MessageSquare, Settings as SettingsIcon } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { api, ApiError, type Settings } from './api.ts';
import { Chat } from './components/Chat.tsx';
import { Roko, type RokoState } from './components/Roko.tsx';
import { ThreadList } from './components/ThreadList.tsx';
import { I18nProvider, useI18n } from './i18n/index.tsx';
import { Locked } from './pages/Locked.tsx';
import { Onboarding } from './pages/Onboarding.tsx';
import { SettingsPage } from './pages/SettingsPage.tsx';

type View = 'chat' | 'settings' | 'onboarding';

const threadFromHash = () => /^#\/t\/([\w-]+)$/.exec(window.location.hash)?.[1];

function Shell({
  settings,
  setSettings,
}: {
  settings: Settings;
  setSettings: (s: Settings) => void;
}) {
  const { t } = useI18n();
  const [view, setView] = useState<View>(
    settings.model ? 'chat' : 'onboarding',
  );
  const [threadId, setThreadId] = useState(
    () => threadFromHash() ?? crypto.randomUUID(),
  );
  const [refreshKey, setRefreshKey] = useState(0);
  const [roko, setRoko] = useState<RokoState>('idle');

  useEffect(() => {
    window.location.hash = `/t/${threadId}`;
  }, [threadId]);

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
  return (
    <div className="shell">
      <nav className="rail" aria-label={t('app.name')}>
        <img src="/rocky/mark.svg" alt={t('app.name')} width={28} height={28} />
        <button
          type="button"
          className="icon-button active"
          aria-label={t('nav.chat')}
        >
          <MessageSquare size={18} />
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
      <ThreadList
        selected={threadId}
        onSelect={setThreadId}
        onNew={() => setThreadId(crypto.randomUUID())}
        refreshKey={refreshKey}
      />
      <Chat
        key={threadId}
        threadId={threadId}
        onActivity={onActivity}
        onState={setRoko}
      />
      <aside className="panel">
        <div className={`presence ${roko}`}>
          <Roko state={roko} size={128} />
          <strong>
            {t(
              roko === 'running'
                ? 'panel.running'
                : roko === 'failed'
                  ? 'panel.failed'
                  : 'panel.idle',
            )}
          </strong>
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
    </div>
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
