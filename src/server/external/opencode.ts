// Finds and starts `opencode acp` the Rocky way (ADR 0003): argv only, an explicit
// environment allowlist (Rocky's token never reaches it), Rocky-owned config in which
// every tool with an effect asks, and the repository's own opencode.json ignored.
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { delimiter, join } from 'node:path';

const isWindows = process.platform === 'win32';

/** The real OpenCode executable; a `.cmd` shim is never run, because that needs a shell. */
export function findOpenCode(): string | undefined {
  const configured = process.env['ROCKY_OPENCODE_BIN'];
  if (configured) return existsSync(configured) ? configured : undefined;
  const dirs = (process.env['PATH'] ?? '').split(delimiter).filter(Boolean);
  const names = isWindows ? ['opencode.exe', 'opencode.cmd'] : ['opencode'];
  for (const name of names) {
    for (const dir of dirs) {
      const candidate = join(dir, name);
      if (!existsSync(candidate)) continue;
      if (!candidate.endsWith('.cmd')) return candidate;
      // npm's global shim sits next to node_modules/opencode-ai/bin/opencode.exe.
      const exe = join(
        dir,
        'node_modules',
        'opencode-ai',
        'bin',
        'opencode.exe',
      );
      if (existsSync(exe)) return exe;
    }
  }
  return undefined;
}

/** Variables the OS and OpenCode need. Everything else in Rocky's environment stays behind. */
const PASS_THROUGH = [
  'PATH',
  'PATHEXT',
  'SystemRoot',
  'SystemDrive',
  'windir',
  'ComSpec',
  'TEMP',
  'TMP',
  'LANG',
  'NODE_EXTRA_CA_CERTS',
  'SSL_CERT_FILE',
  'HTTPS_PROXY',
  'HTTP_PROXY',
  'https_proxy',
  'http_proxy',
];

/** OpenCode features that would reach the network or read config Rocky does not own. */
const LOCKDOWN = {
  OPENCODE_DISABLE_AUTOUPDATE: '1',
  OPENCODE_DISABLE_MODELS_FETCH: '1',
  OPENCODE_DISABLE_SHARE: '1',
  OPENCODE_DISABLE_LSP_DOWNLOAD: '1',
  OPENCODE_DISABLE_DEFAULT_PLUGINS: '1',
  OPENCODE_DISABLE_CLAUDE_CODE: '1',
  OPENCODE_DISABLE_EXTERNAL_SKILLS: '1',
  // A repository's own opencode.json could otherwise turn approvals into "allow".
  OPENCODE_DISABLE_PROJECT_CONFIG: '1',
};

export interface OpenCodeModel {
  baseURL: string;
  model: string;
  apiKey?: string | undefined;
}

export function openCodeConfig(model: OpenCodeModel): object {
  return {
    $schema: 'https://opencode.ai/config.json',
    autoupdate: false,
    share: 'disabled',
    model: `rocky/${model.model}`,
    small_model: `rocky/${model.model}`,
    enabled_providers: ['rocky'],
    provider: {
      rocky: {
        npm: '@ai-sdk/openai-compatible',
        name: 'Rocky',
        options: {
          baseURL: model.baseURL,
          apiKey: '{env:ROCKY_MODEL_API_KEY}',
        },
        models: { [model.model]: { name: model.model, tool_call: true } },
      },
    },
    // Every tool with an effect asks; Rocky answers each request itself.
    permission: {
      '*': 'ask',
      read: 'allow',
      glob: 'allow',
      grep: 'allow',
      list: 'allow',
      todowrite: 'allow',
      todoread: 'allow',
    },
  };
}

export function openCodeEnv(
  home: string,
  model: OpenCodeModel,
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of PASS_THROUGH) {
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }
  const dirs = {
    XDG_CONFIG_HOME: join(home, 'config'),
    XDG_DATA_HOME: join(home, 'data'),
    XDG_CACHE_HOME: join(home, 'cache'),
    XDG_STATE_HOME: join(home, 'state'),
  };
  for (const dir of Object.values(dirs)) mkdirSync(dir, { recursive: true });
  Object.assign(env, dirs, LOCKDOWN, {
    HOME: home,
    USERPROFILE: home,
    OPENCODE_CONFIG_CONTENT: JSON.stringify(openCodeConfig(model)),
    // The model key is the one secret OpenCode needs; Rocky's API token is never passed.
    ROCKY_MODEL_API_KEY: model.apiKey ?? 'not-needed',
    NO_PROXY: '127.0.0.1,localhost',
    no_proxy: '127.0.0.1,localhost',
  });
  return env;
}

export function spawnOpenCode(
  bin: string,
  home: string,
  cwd: string,
  model: OpenCodeModel,
): ChildProcessWithoutNullStreams {
  return spawn(bin, ['acp'], {
    cwd,
    env: openCodeEnv(home, model),
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
    // Its own process group, so a hard stop can end the whole tree (killTree).
    detached: !isWindows,
  });
}
