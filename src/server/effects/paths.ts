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
  const secret =
    !NOT_SECRET.has(name) &&
    (SECRET_PATTERNS.some((pattern) => pattern.test(name)) ||
      parts.some((p) => SECRET_DIRS.has(p)));
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
