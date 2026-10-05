import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  modelConfigSchema,
  type ModelConfig,
  type PublicModel,
} from "../../../packages/contracts/src/models.js";
import { labels, type Locale } from "./i18n.js";
import {
  isRunnable,
  selectionOf,
  type SelectedModel,
} from "./selected-model.js";

type Preset = {
  id: string;
  label: string;
  provider: ModelConfig["provider"];
  baseUrl: string;
  modelId: string;
  placeholder: string;
  credentialRef: string | null;
  contextWindowTokens: number;
  maxOutputTokens: number;
};
const presets: Preset[] = [
  {
    id: "anthropic",
    label: "Anthropic",
    provider: "anthropic",
    baseUrl: "https://api.anthropic.com/v1",
    modelId: "claude-sonnet-5-5",
    placeholder: "claude-sonnet-5-5",
    credentialRef: "ANTHROPIC_API_KEY",
    contextWindowTokens: 200000,
    maxOutputTokens: 8192,
  },
  {
    id: "openai",
    label: "OpenAI",
    provider: "openai",
    baseUrl: "https://api.openai.com/v1",
    modelId: "",
    placeholder: "gpt-…",
    credentialRef: "OPENAI_API_KEY",
    contextWindowTokens: 128000,
    maxOutputTokens: 8192,
  },
  {
    id: "ollama",
    label: "Ollama",
    provider: "ollama-compatible",
    baseUrl: "http://127.0.0.1:11434/v1",
    modelId: "",
    placeholder: "llama3.2",
    credentialRef: null,
    contextWindowTokens: 32768,
    maxOutputTokens: 4096,
  },
  {
    id: "compatible",
    label: "OpenAI-compatible",
    provider: "openai-compatible",
    baseUrl: "",
    modelId: "",
    placeholder: "model-id",
    credentialRef: "ROCKY_MODEL_KEY",
    contextWindowTokens: 32768,
    maxOutputTokens: 4096,
  },
];

/** First-run model setup: pick a configured model, or add one from a provider preset. */
export function ModelOnboarding({
  locale,
  request,
  models,
  onSelect,
  onRefresh,
  onFixture,
  current,
  onCancel,
}: {
  locale: Locale;
  request: (path: string, body?: unknown) => Promise<unknown>;
  models: PublicModel[];
  onSelect: (model: SelectedModel) => void;
  onRefresh: () => Promise<PublicModel[]>;
  onFixture: () => void;
  current?: SelectedModel | null;
  onCancel?: () => void;
}) {
  const t = labels[locale].onboarding;
  const [preset, setPreset] = useState(presets[0]!);
  const [form, setForm] = useState(() => fromPreset(presets[0]!));
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(models.length === 0);
  const [message, setMessage] = useState("");
  const [secrets, setSecrets] = useState<{ path: string; names: string[] }>();
  const root = useRef<HTMLElement>(null);
  useEffect(() => {
    root.current?.scrollIntoView({ block: "nearest" });
  }, []);
  useEffect(() => {
    void request("/local-secrets")
      .then((data) => setSecrets(data as { path: string; names: string[] }))
      .catch(() => undefined);
  }, [request]);
  // Public model records never expose credential names, so only the local secrets file is known here.
  const keyKnown =
    !!form.credentialRef && !!secrets?.names.includes(form.credentialRef);
  function choose(next: Preset) {
    setPreset(next);
    setForm(fromPreset(next));
    setMessage("");
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const config = modelConfigSchema.parse({
        name: `${preset.label} · ${form.modelId}`.slice(0, 80),
        provider: preset.provider,
        baseUrl: form.baseUrl,
        modelId: form.modelId,
        credentialRef: form.credentialRef || null,
        contextWindowTokens: form.contextWindowTokens,
        maxOutputTokens: form.maxOutputTokens,
      });
      if (key.trim() && config.credentialRef)
        await request("/local-secrets", {
          requestId: crypto.randomUUID(),
          name: config.credentialRef,
          value: key.trim(),
        });
      const id = crypto.randomUUID();
      await request("/model-connections", {
        requestId: crypto.randomUUID(),
        id,
        expectedRevision: 0,
        config,
      });
      setKey("");
      const saved = (await onRefresh()).find((model) => model.id === id);
      if (saved && isRunnable(saved)) onSelect(selectionOf(saved));
      else
        setMessage(
          locale === "zh"
            ? `已儲存，但 daemon 找不到 ${config.credentialRef}。請填入 API 金鑰。`
            : `Saved, but the daemon cannot find ${config.credentialRef}. Enter the API key.`,
        );
    } catch (error) {
      setMessage(
        t.failed +
          (error instanceof Error
            ? error.message.startsWith("[")
              ? locale === "zh"
                ? "請檢查網址與模型 ID。"
                : "Check the URL and model ID."
              : error.message
            : String(error)),
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      ref={root}
      className="onboarding"
      aria-labelledby="onboarding-title"
    >
      <div className="onboarding-head">
        <h2 id="onboarding-title">{models.length ? t.switchTitle : t.title}</h2>
        {onCancel && (
          <button type="button" className="link" onClick={onCancel}>
            {t.cancel}
          </button>
        )}
      </div>
      {!models.length && <p>{t.intro}</p>}
      {models.length > 0 && (
        <div className="onboarding-models">
          <h3>{t.pick}</h3>
          <ul>
            {models.map((model) => (
              <li key={model.id}>
                <span>
                  <strong>{model.config.name}</strong>
                  <small>{model.config.modelId}</small>
                </span>
                {current?.connectionId === model.id ? (
                  <small className="in-use">{t.inUse}</small>
                ) : isRunnable(model) ? (
                  <button
                    type="button"
                    onClick={() => onSelect(selectionOf(model))}
                  >
                    {t.use}
                  </button>
                ) : (
                  <small>{t.unusable}</small>
                )}
              </li>
            ))}
          </ul>
          {!adding && (
            <button
              type="button"
              className="add-model"
              onClick={() => setAdding(true)}
            >
              + {t.add}
            </button>
          )}
          {adding && <h3>{t.add}</h3>}
        </div>
      )}
      {adding && (
        <form onSubmit={submit}>
          <fieldset disabled={busy}>
            <div
              className="provider-choices"
              role="radiogroup"
              aria-label={t.provider}
            >
              {presets.map((item) => (
                <button
                  type="button"
                  role="radio"
                  aria-checked={item.id === preset.id}
                  key={item.id}
                  onClick={() => choose(item)}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <label>
              {t.modelId}
              <input
                required
                maxLength={200}
                placeholder={preset.placeholder}
                value={form.modelId}
                onChange={(e) => setForm({ ...form, modelId: e.target.value })}
              />
            </label>
            {form.credentialRef && (
              <label>
                {t.apiKey}
                <input
                  type="password"
                  autoComplete="off"
                  placeholder={keyKnown ? "••••••••" : "sk-…"}
                  value={key}
                  onChange={(e) => setKey(e.target.value)}
                />
                <small>
                  {keyKnown
                    ? t.apiKeyKept
                    : t.apiKeyHint(secrets?.path ?? "secrets.env")}
                </small>
              </label>
            )}
            <details>
              <summary>{t.advanced}</summary>
              <label>
                {t.baseUrl}
                <input
                  type="url"
                  required
                  placeholder="http://127.0.0.1:8000/v1"
                  value={form.baseUrl}
                  onChange={(e) =>
                    setForm({ ...form, baseUrl: e.target.value })
                  }
                />
              </label>
              <label>
                {t.context}
                <input
                  type="number"
                  min="2"
                  required
                  value={form.contextWindowTokens}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      contextWindowTokens: Number(e.target.value),
                    })
                  }
                />
              </label>
              <label>
                {t.maxOutput}
                <input
                  type="number"
                  min="1"
                  required
                  value={form.maxOutputTokens}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      maxOutputTokens: Number(e.target.value),
                    })
                  }
                />
              </label>
              <label>
                {t.envName}
                <input
                  autoComplete="off"
                  pattern="[A-Za-z_][A-Za-z0-9_]{0,127}"
                  value={form.credentialRef}
                  onChange={(e) =>
                    setForm({ ...form, credentialRef: e.target.value })
                  }
                />
              </label>
            </details>
            <div className="onboarding-actions">
              <button className="primary" type="submit">
                {busy ? t.saving : t.submit}
              </button>
              <button
                type="button"
                className="link"
                title={labels[locale].fixtureHint}
                onClick={onFixture}
              >
                {t.tryFixture}
              </button>
            </div>
          </fieldset>
        </form>
      )}
      {message && <p role="alert">{message}</p>}
    </section>
  );
}
function fromPreset(preset: Preset) {
  return {
    baseUrl: preset.baseUrl,
    modelId: preset.modelId,
    credentialRef: preset.credentialRef ?? "",
    contextWindowTokens: preset.contextWindowTokens,
    maxOutputTokens: preset.maxOutputTokens,
  };
}
