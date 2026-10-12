import { ArrowLeft } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { api, type Settings } from '../api.ts';
import { LanguageSwitch } from '../components/LanguageSwitch.tsx';
import { McpSettings } from '../components/McpSettings.tsx';
import { MemoryList } from '../components/MemoryList.tsx';
import { ModeSelect } from '../components/ModeSelect.tsx';
import { SkillList } from '../components/SkillList.tsx';
import { ModelForm } from '../components/ModelForm.tsx';
import { ProjectForm } from '../components/ProjectForm.tsx';
import { RuleList } from '../components/RuleList.tsx';
import { useI18n, type MessageKey } from '../i18n/index.tsx';

interface Section {
  id: string;
  title: MessageKey;
  body: ReactNode;
}

/** The section nearest the top of the window, for the side navigation. */
function useCurrentSection(ids: string[]): string | undefined {
  const [current, setCurrent] = useState(ids[0]);
  const key = ids.join(' ');
  useEffect(() => {
    if (!('IntersectionObserver' in window)) return;
    const visible = new Set<string>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) visible.add(entry.target.id);
          else visible.delete(entry.target.id);
        }
        const first = key.split(' ').find((id) => visible.has(id));
        if (first) setCurrent(first);
      },
      { rootMargin: '-80px 0px -55% 0px' },
    );
    for (const id of key.split(' ')) {
      const element = document.getElementById(id);
      if (element) observer.observe(element);
    }
    return () => observer.disconnect();
  }, [key]);
  return current;
}

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
  const sections: Section[] = [
    {
      id: 'settings-general',
      title: 'settings.general',
      body: (
        <div className="row">
          <span>{t('settings.language')}</span>
          <LanguageSwitch settings={settings} onChange={onChange} />
        </div>
      ),
    },
    {
      id: 'settings-project',
      title: 'settings.project',
      body: <ProjectForm current={settings.project} onSaved={onChange} />,
    },
    {
      id: 'settings-mode',
      title: 'settings.mode',
      body: (
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
      ),
    },
    { id: 'settings-rules', title: 'settings.rules', body: <RuleList /> },
    { id: 'settings-memory', title: 'settings.memory', body: <MemoryList /> },
    { id: 'settings-skills', title: 'settings.skills', body: <SkillList /> },
    { id: 'settings-mcp', title: 'settings.mcp', body: <McpSettings /> },
    {
      id: 'settings-model',
      title: 'settings.model',
      body: <ModelForm current={settings.model} onSaved={onChange} />,
    },
  ];
  const current = useCurrentSection(sections.map((s) => s.id));
  return (
    <div className="settings">
      <header className="topbar">
        <button type="button" className="link" onClick={onBack}>
          <ArrowLeft size={16} aria-hidden="true" />
          {t('settings.back')}
        </button>
        <h1>{t('settings.title')}</h1>
      </header>
      <div className="settings-layout">
        <nav className="settings-nav" aria-label={t('settings.title')}>
          {sections.map((section) => (
            <a
              key={section.id}
              href={`#${section.id}`}
              className={current === section.id ? 'current' : undefined}
              aria-current={current === section.id ? 'true' : undefined}
              onClick={(e) => {
                e.preventDefault();
                document
                  .getElementById(section.id)
                  ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
              }}
            >
              {t(section.title)}
            </a>
          ))}
        </nav>
        <main className="settings-main">
          {sections.map((section) => (
            <section key={section.id} id={section.id} className="card">
              <h2>{t(section.title)}</h2>
              {section.body}
            </section>
          ))}
        </main>
      </div>
    </div>
  );
}
