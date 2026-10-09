import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

// Which part of Rocky may depend on which (ADR 0021). The action gate (effects) and the
// leaf libraries depend on nothing else in Rocky; each SDK stays inside the part that owns it.
// A new dependency that breaks these lines must change this table on purpose.

const src = resolve(import.meta.dirname, '../../src');

/** Rocky's own parts each part may import, besides `shared` (the types both the server and
 * the browser read), which every part may. The server root (compose, main) and http wire
 * everything together. */
const MAY_IMPORT: Record<string, string[] | '*'> = {
  'server/effects': [],
  'server/platform': [],
  'server/memory': [],
  'server/mcp': [],
  'server/documents': [],
  'server/skills': ['server/effects'],
  'server/external': ['server/effects'],
  'server/store': ['server/mcp'],
  'server/jobs': ['server/effects', 'server/external', 'server/store'],
  'server/agent': [
    'server/documents',
    'server/effects',
    'server/jobs',
    'server/mcp',
    'server/memory',
    'server/skills',
    'server/store',
  ],
  'server/http': '*',
  server: '*',
  shared: [],
  web: ['assets'],
};

/** Packages only their owners may import. */
const OWNERS: Record<string, string[]> = {
  deepagents: ['server/agent'],
  langchain: ['server/agent'],
  '@langchain': ['server/agent'],
  '@copilotkit/runtime': ['server/agent', 'server/http'],
  '@copilotkit/react-core': ['web'],
  '@ag-ui': ['server/agent', 'server/store'],
  '@agentclientprotocol/sdk': ['server/external', 'server/jobs'],
  '@modelcontextprotocol/sdk': ['server/mcp'],
  hono: ['server/http'],
  '@hono/node-server': ['server/http', 'server'],
  'cross-spawn': ['server/effects'],
  'node:sqlite': ['server/effects', 'server/jobs', 'server/store'],
  react: ['web'],
};

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return /\.tsx?$/.test(name) ? [path] : [];
  });
}

/** "server/agent" for src/server/agent/x.ts, "server" for src/server/main.ts, "web" for src/web/... */
function partOf(path: string): string {
  const parts = relative(src, path).split(sep);
  if (parts[0] === '..') return parts.slice(1).find((p) => p !== '..') ?? '..';
  if (parts[0] === 'server')
    return parts.length > 2 ? `server/${parts[1]}` : 'server';
  return parts[0]!;
}

function owner(spec: string): string | undefined {
  return Object.keys(OWNERS).find(
    (pkg) => spec === pkg || spec.startsWith(`${pkg}/`),
  );
}

function imports(file: string): string[] {
  const text = readFileSync(file, 'utf8');
  return [
    ...text.matchAll(/^\s*(?:import|export)\b[^'"]*?from\s*'([^']+)'/gm),
    ...text.matchAll(/^\s*import\s*'([^']+)'/gm),
    ...text.matchAll(/\bimport\(\s*'([^']+)'\s*\)/g),
  ].map((m) => m[1]!);
}

describe('layers', () => {
  const all = files(src).map((file) => ({
    file: relative(src, file).split(sep).join('/'),
    part: partOf(file),
    specs: imports(file),
  }));

  it('every part is in the table', () => {
    expect(
      [...new Set(all.map((f) => f.part))].filter((p) => !(p in MAY_IMPORT)),
    ).toEqual([]);
  });

  it('each part imports only the parts it may', () => {
    const broken = all.flatMap(({ file, part, specs }) => {
      const allowed = MAY_IMPORT[part];
      if (allowed === '*') return [];
      return specs
        .filter((s) => s.startsWith('.'))
        .map((s) => partOf(resolve(src, dirname(file), s)))
        .filter(
          (target) =>
            target !== part &&
            target !== 'shared' &&
            !allowed?.includes(target),
        )
        .map((target) => `${file} -> ${target}`);
    });
    expect(broken).toEqual([]);
  });

  it('each SDK is imported only by the part that owns it', () => {
    const broken = all.flatMap(({ file, part, specs }) =>
      specs
        .filter((s) => !s.startsWith('.'))
        .flatMap((s) => {
          const pkg = owner(s);
          return pkg && !OWNERS[pkg]!.includes(part) ? [`${file} -> ${s}`] : [];
        }),
    );
    expect(broken).toEqual([]);
  });

  it('the table catches a violation', () => {
    // Guards the scanner itself: an import it cannot see would make the rules pass vacuously.
    const agent = all.filter((f) => f.part === 'server/agent');
    expect(agent.some((f) => f.specs.some((s) => s === 'deepagents'))).toBe(
      true,
    );
    expect(
      agent.some((f) => f.specs.some((s) => s.startsWith('../effects/'))),
    ).toBe(true);
  });
});
