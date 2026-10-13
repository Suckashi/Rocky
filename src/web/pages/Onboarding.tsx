import { useCallback, useState } from 'react';
import type { Settings } from '../api.ts';
import { LanguageSwitch } from '../components/LanguageSwitch.tsx';
import { ModelForm } from '../components/ModelForm.tsx';
import { ProjectForm } from '../components/ProjectForm.tsx';
import { Roko } from '../components/Roko.tsx';
import { useI18n } from '../i18n/index.tsx';

export function Onboarding({
  settings,
  onChange,
  onDone,
}: {
  settings: Settings;
  onChange: (settings: Settings) => void;
  onDone: () => void;
}) {
  const { t } = useI18n();
  // One action: "start" saves the model form, then opens the conversation.
  const [saveModel, setSaveModel] = useState<(() => Promise<boolean>) | null>(
    null,
  );
  const [starting, setStarting] = useState(false);
  const onReady = useCallback(
    (save: (() => Promise<boolean>) | null) => setSaveModel(() => save),
    [],
  );
  const start = async () => {
    if (!saveModel) return onDone();
    setStarting(true);
    const saved = await saveModel();
    setStarting(false);
    if (saved) onDone();
  };
  const ready = saveModel !== null || settings.model !== null;
  return (
    <div className="onboarding">
      <header className="topbar">
        <span className="brand">
          <img src="/rocky/mark.svg" alt="" width={28} height={28} />
          {t('app.name')}
          <span className="muted">{t('app.local')}</span>
        </span>
        <LanguageSwitch settings={settings} onChange={onChange} />
      </header>
      <main className="onboarding-main">
        <section className="intro">
          <Roko state="waving" size={192} follow />
          <h1>
            {t('roko.greeting')}
            <br />
            {t('onboarding.title')}
          </h1>
          <p>{t('onboarding.intro')}</p>
          <dl className="facts">
            <dt>{t('onboarding.networkLabel')}</dt>
            <dd>{t('onboarding.networkValue')}</dd>
          </dl>
        </section>
        <section className="card">
          <h2>
            <span className="step">1</span>
            {t('onboarding.step1')}
          </h2>
          <ModelForm
            current={settings.model}
            onSaved={onChange}
            onReady={onReady}
          />
          <h2>
            <span className="step">2</span>
            {t('onboarding.step2')}
          </h2>
          <ProjectForm current={settings.project} onSaved={onChange} />
          <div className="row end">
            {!ready && (
              <span className="small muted">{t('onboarding.needModel')}</span>
            )}
            <button type="button" className="secondary" onClick={onDone}>
              {t('onboarding.later')}
            </button>
            <button
              type="button"
              className="primary"
              disabled={!ready || starting}
              onClick={() => void start()}
            >
              {t('onboarding.start')}
            </button>
          </div>
        </section>
      </main>
    </div>
  );
}
