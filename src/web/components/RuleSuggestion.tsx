// Roko suggests a permanent allow rule for a command the user keeps approving.
// Nothing changes unless the user accepts.
import { api } from '../api.ts';
import { commandLine } from '../effects.ts';
import { useI18n } from '../i18n/index.tsx';
import { Roko } from './Roko.tsx';

export interface Suggestion {
  prefix: string[];
  count: number;
  example: string[];
}

export function RuleSuggestion({
  suggestion,
  onDone,
}: {
  suggestion: Suggestion;
  onDone: () => void;
}) {
  const { t } = useI18n();
  const act = async (path: 'accept' | 'dismiss') => {
    await api(`/rules/suggestions/${path}`, 'POST', {
      prefix: suggestion.prefix,
    }).catch(() => undefined);
    onDone();
  };
  return (
    <div className="rule-suggestion" role="status">
      <Roko state="waving" size={36} />
      <div className="rule-suggestion-body">
        <p>
          {t('suggest.text', { count: suggestion.count })}{' '}
          <code className="mono">{commandLine(suggestion.prefix)}</code>
        </p>
        <p className="small muted">{t('suggest.hint')}</p>
        <div className="row">
          <button
            type="button"
            className="primary"
            onClick={() => void act('accept')}
          >
            {t('suggest.accept')}
          </button>
          <button
            type="button"
            className="secondary"
            onClick={() => void act('dismiss')}
          >
            {t('suggest.dismiss')}
          </button>
        </div>
      </div>
    </div>
  );
}
