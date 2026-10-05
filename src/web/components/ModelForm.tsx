// Model settings: provider preset, address, API key (write-only), model, connection test.
import { useState } from 'react';
import {
  api,
  type ModelSettings,
  type Provider,
  type Settings,
} from '../api.ts';
import { useI18n, type MessageKey } from '../i18n/index.tsx';

const PROVIDERS: Provider[] = ['openai-compatible', 'openai', 'ollama'];
const PRESET: Record<Provider, string> = {
  'openai-compatible': 'https://api.commandcode.ai/provider/v1',
  openai: 'https://api.openai.com/v1',
  ollama: 'http://127.0.0.1:11434/v1',
};

type Test =
  | { state: 'idle' }
  | { state: 'testing' }
  | { state: 'ok'; models: string[] }
  | { state: 'failed'; error: string };

export function ModelForm({
  current,
  onSaved,
}: {
  current: ModelSettings | null;
  onSaved: (settings: Settings) => void;
}) {
  const { t } = useI18n();
  const [provider, setProvider] = useState<Provider>(
    current?.provider ?? 'openai-compatible',
  );
  const [baseURL, setBaseURL] = useState(
    current?.baseURL ?? PRESET['openai-compatible'],
  );
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState(current?.model ?? '');
  const [test, setTest] = useState<Test>({ state: 'idle' });
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  const choose = (next: Provider) => {
    setProvider(next);
    setBaseURL(PRESET[next]);
    setTest({ state: 'idle' });
  };

  const runTest = async () => {
    setTest({ state: 'testing' });
    try {
      const result = await api<{
        ok: boolean;
        models?: string[];
        error?: string;
      }>('/settings/model/test', 'POST', {
        provider,
        baseURL,
        ...(apiKey ? { apiKey } : {}),
      });
      setTest(
        result.ok
          ? { state: 'ok', models: result.models ?? [] }
          : { state: 'failed', error: result.error ?? '' },
      );
    } catch (e) {
      setTest({ state: 'failed', error: e instanceof Error ? e.message : '' });
    }
  };

  const save = async () => {
    setError('');
    try {
      const settings = await api<Settings>('/settings/model', 'PUT', {
        provider,
        baseURL,
        model,
        ...(apiKey ? { apiKey } : {}),
      });
      setSaved(true);
      setApiKey('');
      onSaved(settings);
    } catch (e) {
      setError(e instanceof Error ? e.message : '');
    }
  };

  return (
    <div className="model-form">
      <div
        className="provider-grid"
        role="radiogroup"
        aria-label={t('model.provider')}
      >
        {PROVIDERS.map((p) => (
          <button
            key={p}
            type="button"
            role="radio"
            aria-checked={provider === p}
            className={`provider ${provider === p ? 'selected' : ''}`}
            onClick={() => choose(p)}
          >
            <strong>{t(`model.provider.${p}` as MessageKey)}</strong>
            <span>{t(`model.provider.${p}.hint` as MessageKey)}</span>
          </button>
        ))}
      </div>
      <div className="fields">
        <label>
          {t('model.baseURL')}
          <input
            className="mono"
            value={baseURL}
            onChange={(e) => setBaseURL(e.target.value)}
            spellCheck={false}
          />
        </label>
        {provider !== 'ollama' && (
          <label>
            {t('model.apiKey')}
            <input
              className="mono"
              type="password"
              autoComplete="off"
              value={apiKey}
              placeholder={current?.hasApiKey ? t('model.apiKey.saved') : ''}
              onChange={(e) => setApiKey(e.target.value)}
            />
          </label>
        )}
        <div className="row">
          <button
            type="button"
            className="secondary"
            onClick={() => void runTest()}
          >
            {test.state === 'testing' ? t('model.testing') : t('model.test')}
          </button>
          {test.state === 'ok' && (
            <span className="ok">
              {t('model.test.ok', { count: test.models.length })}
            </span>
          )}
          {test.state === 'failed' && (
            <span className="bad">
              {t('model.test.failed', { error: test.error })}
            </span>
          )}
        </div>
        <label>
          {t('model.model')}
          <input
            className="mono"
            list="rocky-models"
            value={model}
            placeholder={t('model.model.placeholder')}
            onChange={(e) => setModel(e.target.value)}
            spellCheck={false}
          />
          <datalist id="rocky-models">
            {test.state === 'ok' &&
              test.models.map((m) => <option key={m} value={m} />)}
          </datalist>
        </label>
        <div className="row">
          <button
            type="button"
            className="primary"
            disabled={!model.trim() || !baseURL.trim()}
            onClick={() => void save()}
          >
            {t('model.save')}
          </button>
          {saved && <span className="ok">{t('model.saved')}</span>}
          {error && <span className="bad">{error}</span>}
        </div>
      </div>
    </div>
  );
}
