// Finds and starts `opencode acp` the Rocky way: argv only (no shell), an explicit
// environment allowlist (the Rocky token never reaches the child), Rocky-owned config.
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { delimiter, join } from 'node:path';

const isWindows = process.platform === 'win32';

/** Resolves the real OpenCode executable. A `.cmd` shim is never run, because that needs a shell. */
export function resolveOpenCode(): string {
  const configured = process.env['ROCKY_OPENCODE_BIN'];
  if (configured) return configured;
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
  throw new Error(
    'OpenCode not found. Install it (npm i -g opencode-ai) or set ROCKY_OPENCODE_BIN.',
  );
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
  apiKey?: string;
}

export interface OpenCodeOptions {
  /** Private home for OpenCode's config, data (sessions) and cache. Reuse it to resume sessions. */
  home: string;
  cwd: string;
  model: OpenCodeModel;
  /** Outbound proxy for the child; Rocky uses its host-logging proxy here. */
  proxy?: string;
}

export function openCodeConfig(model: OpenCodeModel): object {
  return {
    $schema: 'https://opencode.ai/config.json',
    autoupdate: false,
    share: 'disabled',
    model: `rocky/${model.model}`,
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
    },
  };
}

export function openCodeEnv(options: OpenCodeOptions): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of PASS_THROUGH) {
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }
  const { home } = options;
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
    OPENCODE_CONFIG_CONTENT: JSON.stringify(openCodeConfig(options.model)),
    ROCKY_MODEL_API_KEY: options.model.apiKey ?? 'not-needed',
    NO_PROXY: '127.0.0.1,localhost',
    no_proxy: '127.0.0.1,localhost',
  });
  if (options.proxy) {
    for (const key of [
      'HTTPS_PROXY',
      'HTTP_PROXY',
      'https_proxy',
      'http_proxy',
    ]) {
      env[key] = options.proxy;
    }
  }
  return env;
}

export function spawnOpenCode(
  options: OpenCodeOptions,
): ChildProcessWithoutNullStreams {
  const bin = resolveOpenCode();
  return spawn(bin, ['acp'], {
    cwd: options.cwd,
    env: openCodeEnv(options),
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });
}
