import type { Settings } from '../api.ts';
import { LanguageSwitch } from '../components/LanguageSwitch.tsx';
import { ModelForm } from '../components/ModelForm.tsx';
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
          <Roko state="waving" size={192} />
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
          <ModelForm current={settings.model} onSaved={onChange} />
          <div className="row end">
            <button type="button" className="secondary" onClick={onDone}>
              {t('onboarding.later')}
            </button>
            <button
              type="button"
              className="primary"
              disabled={!settings.model}
              onClick={onDone}
            >
              {t('onboarding.start')}
            </button>
          </div>
        </section>
      </main>
    </div>
  );
}
