// Finds and starts `opencode acp` the Rocky way (ADR 0003): argv only, an explicit
// environment allowlist (Rocky's token never reaches it), Rocky-owned config in which
// every tool with an effect asks, and the repository's own opencode.json ignored.
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomBytes } from 'node:crypto';
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

/** Secret files ask before OpenCode reads them, matching Rocky's own list (effects/paths.ts).
 * OpenCode 1.18 turns `\` into `/` before matching, `*` also matches `/`, the most specific
 * (longest) pattern wins, and matching is case-sensitive on every platform. */
const SECRET_NAMES = [
  '.netrc',
  '.npmrc',
  '.pypirc',
  'credentials',
  'credentials.json',
  ...['rsa', 'dsa', 'ecdsa', 'ed25519'].flatMap((k) => [
    `id_${k}`,
    `id_${k}.pub`,
  ]),
];
const SECRET_DIRS = ['.ssh', '.aws', '.gnupg', '.azure', '.kube'];
const SECRET_PATTERNS = [
  '*.env',
  '*.env.*',
  ...['pem', 'key', 'pfx', 'p12', 'keystore', 'jks'].map((e) => `*.${e}`),
  ...SECRET_NAMES.map((n) => `*/${n}`),
  ...SECRET_DIRS.map((d) => `*/${d}/*`),
];
const NOT_SECRET_PATTERNS = ['example', 'sample', 'template', 'defaults'].map(
  (x) => `*.env.${x}`,
);

/** Windows file names ignore case but OpenCode's patterns do not, and they have no
 * character classes: add the usual spellings (.ENV, Server.Key, Credentials.json). Other
 * mixes such as .eNv still read without asking. */
function spellings(pattern: string): string[] {
  const words = (p: string) =>
    p.replace(/[a-z]+/g, (w) => w[0]!.toUpperCase() + w.slice(1));
  const first = pattern.replace(/[a-z]/, (c) => c.toUpperCase());
  return [...new Set([pattern, pattern.toUpperCase(), words(pattern), first])];
}

export function readPermission(
  platform: NodeJS.Platform = process.platform,
): Record<string, 'allow' | 'ask'> {
  const forms = (p: string) => (platform === 'win32' ? spellings(p) : [p]);
  return Object.fromEntries([
    ['*', 'allow'],
    ...SECRET_PATTERNS.flatMap(forms).map((p) => [p, 'ask']),
    ...NOT_SECRET_PATTERNS.flatMap(forms).map((p) => [p, 'allow']),
  ]);
}

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
      read: readPermission(),
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
    // `opencode acp` also serves HTTP on a loopback port; without a password any local
    // process could drive it. A new one each start, known only to OpenCode itself.
    OPENCODE_SERVER_PASSWORD: randomBytes(24).toString('base64url'),
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
