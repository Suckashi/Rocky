// Permanent rules in Settings: command prefixes that are always allowed or always refused.
// Always visible and removable; an allow rule never covers dangerous commands or outside actions.
import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../api.ts';
import { commandLine } from '../effects.ts';
import { useI18n, type MessageKey } from '../i18n/index.tsx';
import { RuleSuggestion, type Suggestion } from './RuleSuggestion.tsx';

interface Rule {
  id: string;
  decision: 'allow' | 'deny';
  prefix: string[];
}

const ERRORS = [
  'empty',
  'not-one-command',
  'star-not-last',
  'too-broad',
  'duplicate',
];

export function RuleList() {
  const { t } = useI18n();
  const [rules, setRules] = useState<Rule[] | null>(null);
  const [decision, setDecision] = useState<'allow' | 'deny'>('allow');
  const [pattern, setPattern] = useState('');
  const [error, setError] = useState('');
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);

  const load = useCallback(() => {
    void api<{ rules: Rule[] }>('/rules')
      .then((r) => setRules(r.rules))
      .catch(() => undefined);
    void api<{ suggestions: Suggestion[] }>('/rules/suggestions')
      .then((r) => setSuggestions(r.suggestions))
      .catch(() => undefined);
  }, []);
  useEffect(load, [load]);

  const add = async () => {
    try {
      await api('/rules', 'POST', { decision, pattern });
      setPattern('');
      setError('');
      load();
    } catch (e) {
      const code = e instanceof Error ? e.message : '';
      setError(
        e instanceof ApiError && ERRORS.includes(code)
          ? t(`rules.error.${code}` as MessageKey)
          : t('rules.error', { error: code }),
      );
    }
  };

  const remove = async (rule: Rule) => {
    await api(`/rules/${rule.id}`, 'DELETE', {});
    load();
  };

  return (
    <div className="memory-list">
      <p className="small muted">{t('rules.hint')}</p>
      {suggestions.map((suggestion) => (
        <RuleSuggestion
          key={suggestion.prefix.join(' ')}
          suggestion={suggestion}
          onDone={load}
        />
      ))}
      {rules?.length === 0 && <p className="small muted">{t('rules.empty')}</p>}
      {rules && rules.length > 0 && (
        <ul className="rule-list">
          {rules.map((rule) => (
            <li key={rule.id} className="row">
              <span
                className={`badge ${rule.decision === 'allow' ? 'status-verified' : 'status-failed'}`}
              >
                {t(`rules.${rule.decision}`)}
              </span>
              <span className="mono small rule-pattern">
                {commandLine(rule.prefix)}
              </span>
              <button
                type="button"
                className="secondary"
                onClick={() => void remove(rule)}
              >
                {t('rules.remove')}
              </button>
            </li>
          ))}
        </ul>
      )}
      <form
        className="row rule-form"
        onSubmit={(e) => {
          e.preventDefault();
          void add();
        }}
      >
        <select
          aria-label={t('rules.decision')}
          value={decision}
          onChange={(e) => setDecision(e.target.value as 'allow' | 'deny')}
        >
          <option value="allow">{t('rules.allow')}</option>
          <option value="deny">{t('rules.deny')}</option>
        </select>
        <input
          className="mono"
          value={pattern}
          spellCheck={false}
          placeholder={t('rules.placeholder')}
          aria-label={t('rules.pattern')}
          onChange={(e) => setPattern(e.target.value)}
        />
        <button type="submit" className="primary" disabled={!pattern.trim()}>
          {t('rules.add')}
        </button>
      </form>
      {error && (
        <p className="error small" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
