import { api, type Locale, type Settings } from '../api.ts';
import { useI18n } from '../i18n/index.tsx';

const LOCALES: Locale[] = ['zh-TW', 'en'];

export function LanguageSwitch({
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
      aria-label={t('settings.language')}
    >
      {LOCALES.map((locale) => (
        <button
          key={locale}
          type="button"
          role="radio"
          aria-checked={settings.locale === locale}
          className={settings.locale === locale ? 'selected' : ''}
          onClick={() =>
            void api<Settings>('/settings/locale', 'PUT', { locale }).then(
              onChange,
            )
          }
        >
          {t(`lang.${locale}`)}
        </button>
      ))}
    </div>
  );
}
