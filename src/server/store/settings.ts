// User settings. The model API key lives in its own user-only file and is never sent to
// the browser: the UI only learns whether one is set.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';

export type Provider = 'openai-compatible' | 'openai' | 'ollama';
export type Locale = 'zh-TW' | 'en';

export interface ModelSettings {
  provider: Provider;
  baseURL: string;
  model: string;
}

export type ApprovalMode = 'ask-always' | 'ask-when-needed' | 'hands-off';

export interface PublicSettings {
  locale: Locale;
  model: (ModelSettings & { hasApiKey: boolean }) | null;
  project: string | null;
  mode: ApprovalMode;
}

export const DEFAULT_BASE_URL: Record<Provider, string> = {
  'openai-compatible': '',
  openai: 'https://api.openai.com/v1',
  ollama: 'http://127.0.0.1:11434/v1',
};

export class SettingsStore {
  private readonly db: DatabaseSync;
  private readonly secretsFile: string;

  constructor(db: DatabaseSync, dataDir: string) {
    this.db = db;
    this.secretsFile = join(dataDir, 'secrets.json');
  }

  private get<T>(key: string): T | undefined {
    const row = this.db
      .prepare('select value from settings where key = ?')
      .get(key) as { value: string } | undefined;
    return row ? (JSON.parse(row.value) as T) : undefined;
  }

  private set(key: string, value: unknown): void {
    this.db
      .prepare(
        'insert into settings (key, value) values (?, ?) on conflict(key) do update set value = excluded.value',
      )
      .run(key, JSON.stringify(value));
  }

  locale(): Locale {
    return this.get<Locale>('locale') ?? 'zh-TW';
  }

  setLocale(locale: Locale): void {
    this.set('locale', locale);
  }

  project(): string | undefined {
    return this.get<string>('project');
  }

  setProject(path: string): void {
    this.set('project', path);
  }

  mode(): ApprovalMode {
    return this.get<ApprovalMode>('mode') ?? 'ask-when-needed';
  }

  setMode(mode: ApprovalMode): void {
    this.set('mode', mode);
  }

  model(): ModelSettings | undefined {
    return this.get<ModelSettings>('model');
  }

  setModel(model: ModelSettings, apiKey?: string): void {
    this.set('model', model);
    if (apiKey !== undefined)
      this.writeSecrets({ ...this.readSecrets(), modelApiKey: apiKey });
  }

  apiKey(): string | undefined {
    return this.readSecrets().modelApiKey || undefined;
  }

  public(): PublicSettings {
    const model = this.model();
    return {
      locale: this.locale(),
      model: model
        ? { ...model, hasApiKey: this.apiKey() !== undefined }
        : null,
      project: this.project() ?? null,
      mode: this.mode(),
    };
  }

  private readSecrets(): { modelApiKey?: string } {
    if (!existsSync(this.secretsFile)) return {};
    return JSON.parse(readFileSync(this.secretsFile, 'utf8')) as {
      modelApiKey?: string;
    };
  }

  private writeSecrets(secrets: { modelApiKey?: string }): void {
    writeFileSync(this.secretsFile, JSON.stringify(secrets), { mode: 0o600 });
  }
}
