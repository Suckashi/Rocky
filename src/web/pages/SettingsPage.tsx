import { api, type Settings } from '../api.ts';
import { LanguageSwitch } from '../components/LanguageSwitch.tsx';
import { McpSettings } from '../components/McpSettings.tsx';
import { MemoryList } from '../components/MemoryList.tsx';
import { ModeSelect } from '../components/ModeSelect.tsx';
import { SkillList } from '../components/SkillList.tsx';
import { ModelForm } from '../components/ModelForm.tsx';
import { ProjectForm } from '../components/ProjectForm.tsx';
import { RuleList } from '../components/RuleList.tsx';
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
          <h2>{t('settings.project')}</h2>
          <ProjectForm current={settings.project} onSaved={onChange} />
        </section>
        <section className="card">
          <h2>{t('settings.mode')}</h2>
          <div className="row">
            <span className="small muted">{t('settings.mode.hint')}</span>
            <ModeSelect
              value={settings.mode}
              onChange={(mode) =>
                void api<Settings>('/settings/mode', 'PUT', { mode }).then(
                  onChange,
                )
              }
            />
          </div>
        </section>
        <section className="card">
          <h2>{t('settings.rules')}</h2>
          <RuleList />
        </section>
        <section className="card">
          <h2>{t('settings.memory')}</h2>
          <MemoryList />
        </section>
        <section className="card">
          <h2>{t('settings.skills')}</h2>
          <SkillList />
        </section>
        <section className="card">
          <h2>{t('settings.mcp')}</h2>
          <McpSettings />
        </section>
        <section className="card">
          <h2>{t('settings.model')}</h2>
          <ModelForm current={settings.model} onSaved={onChange} />
        </section>
      </main>
    </div>
  );
}
