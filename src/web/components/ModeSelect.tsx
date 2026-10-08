// The approval mode, next to the input box (per conversation) or in Settings (default).
import { MODES, type Mode } from '../api.ts';
import { useI18n } from '../i18n/index.tsx';

export function ModeSelect({
  value,
  onChange,
  disabled = false,
}: {
  value: Mode;
  onChange: (mode: Mode) => void;
  disabled?: boolean;
}) {
  const { t } = useI18n();
  return (
    <select
      className="mode-select"
      value={value}
      disabled={disabled}
      aria-label={t('mode.label')}
      title={t(`mode.${value}.hint`)}
      onChange={(e) => onChange(e.target.value as Mode)}
    >
      {MODES.map((mode) => (
        <option key={mode} value={mode} title={t(`mode.${mode}.hint`)}>
          {t(`mode.${mode}`)}
        </option>
      ))}
    </select>
  );
}
