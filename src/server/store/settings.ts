// User settings. The model API key lives in its own user-only file and is never sent to
// the browser: the UI only learns whether one is set.
import { existsSync, readFileSync } from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import type { McpServerConfig, ToolPolicy } from '../mcp/manager.ts';
import {
  renameRetrying,
  tempOf,
  writeFileAtomic,
} from '../effects/atomic-write.ts';

interface Secrets {
  modelApiKey?: string;
  /** MCP server settings can carry tokens (env, headers), so they live with the secrets. */
  mcpServers?: McpServerConfig[];
}

const brokenOf = (file: string) => `${file}.broken`;

/** Every file the model key and MCP tokens can be in: the file itself, the temporary file a
 * write goes through, and an unreadable copy kept aside. All are private (ADR 0028). */
export function secretsFiles(dataDir: string): string[] {
  const file = join(dataDir, 'secrets.json');
  return [file, tempOf(file), brokenOf(file)];
}

export type { Locale, Provider } from '../../shared/types.ts';
import type { Locale, Mode, Provider } from '../../shared/types.ts';

export interface ModelSettings {
  provider: Provider;
  baseURL: string;
  model: string;
}

export interface PublicSettings {
  locale: Locale;
  model: (ModelSettings & { hasApiKey: boolean }) | null;
  project: string | null;
  mode: Mode;
}

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

  mode(): Mode {
    return this.get<Mode>('mode') ?? 'ask-when-needed';
  }

  setMode(mode: Mode): void {
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

  mcpServers(): McpServerConfig[] {
    return this.readSecrets().mcpServers ?? [];
  }

  setMcpServers(servers: McpServerConfig[]): void {
    this.writeSecrets({ ...this.readSecrets(), mcpServers: servers });
  }

  /** Per-tool approval for MCP tools, keyed "server/tool"; unset means "ask". */
  toolPolicies(): Record<string, ToolPolicy> {
    return this.get<Record<string, ToolPolicy>>('mcpToolPolicies') ?? {};
  }

  setToolPolicy(server: string, tool: string, policy: ToolPolicy): void {
    const all = this.toolPolicies();
    if (policy === 'ask') delete all[`${server}/${tool}`];
    else all[`${server}/${tool}`] = policy;
    this.set('mcpToolPolicies', all);
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

  private readSecrets(): Secrets {
    if (!existsSync(this.secretsFile)) return {};
    // A byte-order mark (some editors add one) is not part of the JSON.
    const text = readFileSync(this.secretsFile, 'utf8').replace(/^\uFEFF/, '');
    try {
      return JSON.parse(text) as Secrets;
    } catch {
      // Unreadable (cut off before writes were atomic): keep it aside for the owner, and
      // start without the key and MCP servers rather than not at all.
      // An older kept-aside copy is replaced: the newest is the one most likely current.
      renameRetrying(this.secretsFile, brokenOf(this.secretsFile));
      console.error(
        `secrets.json could not be read; moved to ${brokenOf(this.secretsFile)}. Enter the model key again in Settings.`,
      );
      return {};
    }
  }

  private writeSecrets(secrets: Secrets): void {
    writeFileAtomic(this.secretsFile, JSON.stringify(secrets));
  }
}
