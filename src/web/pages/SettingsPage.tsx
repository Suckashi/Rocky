import type { Settings } from '../api.ts';
import { LanguageSwitch } from '../components/LanguageSwitch.tsx';
import { ModelForm } from '../components/ModelForm.tsx';
import { useI18n } from '../i18n/index.tsx';

export function SettingsPage({
  settings,
  onChange,
  onBack,
}: {
  settings: Settings;
  onChange: (settings: Settings) => void;
  onBack: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className="settings">
      <header className="topbar">
        <button type="button" className="link" onClick={onBack}>
          ← {t('settings.back')}
        </button>
        <h1>{t('settings.title')}</h1>
      </header>
      <main className="settings-main">
        <section className="card">
          <h2>{t('settings.general')}</h2>
          <div className="row">
            <span>{t('settings.language')}</span>
            <LanguageSwitch settings={settings} onChange={onChange} />
          </div>
        </section>
        <section className="card">
          <h2>{t('settings.model')}</h2>
          <ModelForm current={settings.model} onSaved={onChange} />
        </section>
      </main>
    </div>
  );
}
