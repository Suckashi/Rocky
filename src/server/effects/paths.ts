// Path classification for the action gate: inside the project or not, secret, protected.
// Comparisons are case-insensitive on Windows. Pass path.win32 / path.posix to test both.
import { realpathSync } from 'node:fs';
import path, { type PlatformPath } from 'node:path';

const NOT_SECRET = new Set([
  '.env.example',
  '.env.sample',
  '.env.template',
  '.env.defaults',
]);

const SECRET_PATTERNS: RegExp[] = [
  /^\.env$/,
  /^\.env\..+$/,
  /\.(pem|key|pfx|p12|keystore|jks)$/,
  /^id_(rsa|dsa|ecdsa|ed25519)(\.pub)?$/,
  /^\.netrc$/,
  /^\.npmrc$/,
  /^\.pypirc$/,
  /^credentials(\.json)?$/,
];
const SECRET_DIRS = new Set(['.ssh', '.aws', '.gnupg', '.azure', '.kube']);

const PROTECTED_DIRS = new Set([
  '.git',
  '.vscode',
  '.idea',
  '.github',
  '.husky',
]);
const PROTECTED_FILES = new Set([
  'agents.md',
  'claude.md',
  '.gitattributes',
  '.gitmodules',
  '.npmrc',
  '.yarnrc',
  '.yarnrc.yml',
  '.editorconfig',
]);

export interface PathFacts {
  /** Absolute, normalized path. */
  absolute: string;
  /** Path relative to the project with forward slashes, or undefined when outside it. */
  relative: string | undefined;
  secret: boolean;
  protected: boolean;
}

function segments(p: string, api: PlatformPath): string[] {
  return p.split(api.sep).filter(Boolean);
}

/** Resolves symlinks/junctions of the deepest existing ancestor, so a link cannot smuggle a path out. */
export function realPath(p: string, api: PlatformPath = path): string {
  if (api !== path) return p;
  let current = p;
  const tail: string[] = [];
  for (;;) {
    try {
      return api.join(realpathSync.native(current), ...tail.reverse());
    } catch {
      const parent = api.dirname(current);
      if (parent === current) return p;
      tail.push(api.basename(current));
      current = parent;
    }
  }
}

function secretParts(parts: string[]): boolean {
  const name = parts.at(-1) ?? '';
  return (
    !NOT_SECRET.has(name) &&
    (SECRET_PATTERNS.some((pattern) => pattern.test(name)) ||
      parts.some((p) => SECRET_DIRS.has(p)))
  );
}

/** Whether a path names a secret by its own words, without resolving it (a path whose start
 * a shell replaces, so only the rest can be judged). */
export function namesSecret(p: string, api: PlatformPath = path): boolean {
  const windows = api === path.win32;
  return secretParts(
    (windows ? p.toLowerCase() : p).split(/[\\/]/).filter(Boolean),
  );
}

/** Names a glob is tried against: when one matches, the glob may name a secret. */
const SECRET_SAMPLES = [
  '.env',
  '.env.local',
  '.env.production',
  'id_rsa',
  'id_dsa',
  'id_ecdsa',
  'id_ed25519',
  'server.key',
  'server.pem',
  'cert.pfx',
  'cert.p12',
  'app.keystore',
  'app.jks',
  '.netrc',
  '.npmrc',
  '.pypirc',
  'credentials',
  'credentials.json',
  'secrets.json',
  'api-token',
  ...SECRET_DIRS,
];

/** Whether a word with a glob (`*`, `?`, `[...]`) may match a secret name (`.e*`, `.en?`). */
export function globNamesSecret(
  word: string,
  api: PlatformPath = path,
): boolean {
  if (!/[*?[]/.test(word)) return false;
  const windows = api === path.win32;
  return (
    (windows ? word.toLowerCase() : word)
      .split(/[\\/]/)
      // A glob made of wildcards alone names nothing in particular (`public/*`).
      .filter(
        (part) =>
          /[*?[]/.test(part) &&
          part.replace(/\[[^\]]*\]|[*?]/g, '').length >= 2,
      )
      .some((part) => {
        let pattern: RegExp;
        try {
          pattern = new RegExp(
            `^${part
              .replace(/[.+^${}()|\\]/g, '\\$&')
              .replace(/\*/g, '.*')
              .replace(/\?/g, '.')
              .replace(/\[!/g, '[^')}$`,
          );
        } catch {
          // An unclosed [ is a literal character to the shell.
          return false;
        }
        // The shell's globs match a name starting with a dot only when they start with one.
        return SECRET_SAMPLES.some(
          (name) =>
            (part.startsWith('.') || !name.startsWith('.')) &&
            pattern.test(name),
        );
      })
  );
}

/** Whether a path names a protected file by its own words, without resolving it. */
export function namesProtected(p: string): boolean {
  const parts = p.toLowerCase().split(/[\\/]/).filter(Boolean);
  return (
    parts.some((part) => PROTECTED_DIRS.has(part)) ||
    PROTECTED_FILES.has(parts.at(-1) ?? '')
  );
}

/** Rocky's own secret files (ADR 0028), resolved through links like every judged path. */
export function privateFiles(
  files: readonly string[],
  api: PlatformPath = path,
) {
  const windows = api === path.win32;
  const norm = (p: string) => (windows ? p.toLowerCase() : p);
  const full = new Set(files.map((f) => norm(realPath(api.resolve(f), api))));
  const names = new Set(files.map((f) => norm(api.basename(f))));
  return {
    /** An absolute path from classifyPath. */
    has: (absolute: string) => full.has(norm(absolute)),
    /** A path whose start a shell replaces: only its file name can be compared. */
    named: (p: string) => names.has(norm(p.split(/[\\/]/).pop() ?? '')),
  };
}

export function classifyPath(
  target: string,
  projectRoot: string,
  cwd: string = projectRoot,
  api: PlatformPath = path,
): PathFacts {
  const windows = api === path.win32;
  const norm = (p: string) => (windows ? p.toLowerCase() : p);
  const absolute = realPath(api.resolve(cwd, target), api);
  const root = realPath(api.resolve(projectRoot), api);
  const rel = api.relative(norm(root), norm(absolute));
  const inside = rel === '' || (!rel.startsWith('..') && !api.isAbsolute(rel));
  const parts = segments(norm(absolute), api);
  const name = parts.at(-1) ?? '';
  const secret = secretParts(parts);
  const relParts = inside ? segments(rel, api) : parts;
  const isProtected =
    relParts.some((p) => PROTECTED_DIRS.has(p.toLowerCase())) ||
    PROTECTED_FILES.has(name.toLowerCase());
  return {
    absolute,
    relative: inside
      ? rel === ''
        ? '.'
        : api.relative(root, absolute).split(api.sep).join('/')
      : undefined,
    secret,
    protected: isProtected,
  };
}

/** Command arguments that look like file paths (have a separator, a leading dot, or a drive). */
export function pathLikeArgs(argv: string[]): string[] {
  return argv.filter(
    (token, i) =>
      i > 0 &&
      !token.startsWith('-') &&
      !/^\/[a-z?]$/i.test(token) &&
      !token.includes('://') &&
      (/[\\/]/.test(token) ||
        /^\.{1,2}($|[\\/])/.test(token) ||
        /^[a-z]:/i.test(token) ||
        /^\.[\w-]/.test(token)),
  );
}
