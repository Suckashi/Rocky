// Light, dark, or the system's choice; kept in Rocky's settings and in this browser so the
// next start paints in the right theme before the settings arrive.
import { api, type Settings, type Theme } from '../api.ts';
import { useI18n } from '../i18n/index.tsx';

const THEMES: Theme[] = ['system', 'light', 'dark'];
const STORAGE_KEY = 'rocky.theme';

/** Puts the theme on <html>; "system" leaves it to the operating system. */
export function applyTheme(theme: Theme): void {
  if (theme === 'system') delete document.documentElement.dataset['theme'];
  else document.documentElement.dataset['theme'] = theme;
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Storage can be unavailable (private windows); the setting still applies now.
  }
}

/** The theme this browser last used, applied before the first paint. */
export function applyStoredTheme(): void {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'light' || stored === 'dark') applyTheme(stored);
  } catch {
    // Nothing stored: the system theme applies until the settings arrive.
  }
}

export function ThemeSwitch({
  settings,
  onChange,
}: {
  settings: Settings;
  onChange: (settings: Settings) => void;
}) {
  const { t } = useI18n();
  return (
    <div
      className="segmented"
      role="radiogroup"
      aria-label={t('settings.theme')}
    >
      {THEMES.map((theme) => (
        <button
          key={theme}
          type="button"
          role="radio"
          aria-checked={settings.theme === theme}
          className={settings.theme === theme ? 'selected' : ''}
          onClick={() =>
            void api<Settings>('/settings/theme', 'PUT', { theme }).then(
              onChange,
            )
          }
        >
          {t(`theme.${theme}`)}
        </button>
      ))}
    </div>
  );
}
