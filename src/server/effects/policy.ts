// The decision order (ADR 0007). First rule with a verdict wins:
// deny rules, dangerous commands, secrets/protected paths, external actions,
// session approvals, allow rules, then the mode.
import path, { type PlatformPath } from 'node:path';
import { analyzeCommand, findDanger, programName } from './commands.ts';
import { contentHash, sessionKey } from './hash.ts';
import { classifyPath, pathLikeArgs } from './paths.ts';
import type { Decision, Effect, Mode, Reason, Rule, Verdict } from './types.ts';

export interface PolicyContext {
  projectRoot: string;
  mode: Mode;
  rules: Rule[];
  sessionApprovals: ReadonlySet<string>;
  /** Commands that run without asking even in ask-always (argv prefixes, `*` wildcard). */
  safeList: string[][];
  /** True when the file existed before this work started (deleting it is external). */
  existedBefore: (absolutePath: string) => boolean;
  pathApi?: PlatformPath;
}

export function matchesPrefix(
  argv: string[],
  prefix: string[],
  windows: boolean,
): boolean {
  const eq = (a: string, b: string, i: number) =>
    i === 0
      ? programName(a) === programName(b)
      : windows
        ? a.toLowerCase() === b.toLowerCase()
        : a === b;
  for (let i = 0; i < prefix.length; i++) {
    if (prefix[i] === '*' && i === prefix.length - 1) return true;
    if (i >= argv.length || !eq(argv[i]!, prefix[i]!, i)) return false;
  }
  return argv.length === prefix.length;
}

export function decide(effect: Effect, ctx: PolicyContext): Verdict {
  const api = ctx.pathApi ?? path;
  const windows = api === path.win32;
  const base = {
    contentHash: contentHash(effect),
    sessionKey: sessionKey(effect),
  };
  const verdict = (
    decision: Decision,
    reason: Reason,
    detail?: string,
  ): Verdict => ({
    decision,
    reason,
    ...(detail !== undefined ? { detail } : {}),
    ...base,
  });

  // A plan is a question for the user by nature: it always asks, in every mode.
  if (effect.kind === 'plan') return verdict('ask', 'plan');

  // Every program a command really runs, after unwrapping.
  const analysis =
    effect.kind === 'command' ? analyzeCommand(effect.argv) : undefined;
  const programs = analysis?.kind === 'parsed' ? analysis.commands : [];

  // 1. Deny rules.
  if (effect.kind === 'command') {
    const deny = ctx.rules.filter((r) => r.decision === 'deny');
    const targets = [effect.argv, ...programs.map((p) => p.argv)];
    for (const rule of deny) {
      if (targets.some((argv) => matchesPrefix(argv, rule.prefix, windows))) {
        return verdict('deny', 'deny-rule', rule.prefix.join(' '));
      }
    }
  }

  // 2. Dangerous commands always ask; unparseable ones ask in ask-always.
  if (effect.kind === 'command' && analysis) {
    if (analysis.kind === 'parsed') {
      const danger = findDanger(programs);
      if (danger) return verdict('ask', 'dangerous', danger);
    } else if (ctx.mode === 'ask-always') {
      return verdict('ask', 'unparseable', analysis.reason);
    }
  }

  // 3. Secrets and protected paths; 4. external actions.
  const external = (detail: string) => verdict('ask', 'external', detail);
  if (effect.kind === 'read' || effect.kind === 'write') {
    const facts = classifyPath(
      effect.path,
      ctx.projectRoot,
      ctx.projectRoot,
      api,
    );
    if (facts.secret) {
      return effect.kind === 'read'
        ? verdict('deny', 'secret', facts.absolute)
        : verdict('ask', 'secret', facts.absolute);
    }
    if (effect.kind === 'write' && facts.protected)
      return verdict('ask', 'protected', facts.absolute);
    if (facts.relative === undefined)
      return external(`outside-project:${facts.absolute}`);
    if (
      effect.kind === 'write' &&
      effect.operation === 'delete' &&
      ctx.existedBefore(facts.absolute)
    ) {
      return external(`delete-existing:${facts.absolute}`);
    }
  }
  if (effect.kind === 'command') {
    const cwdFacts = classifyPath(
      effect.cwd,
      ctx.projectRoot,
      ctx.projectRoot,
      api,
    );
    if (cwdFacts.relative === undefined)
      return external(`cwd-outside-project:${cwdFacts.absolute}`);
    for (const program of programs) {
      for (const arg of [...pathLikeArgs(program.argv), ...program.redirects]) {
        const facts = classifyPath(arg, ctx.projectRoot, effect.cwd, api);
        if (facts.secret) return verdict('ask', 'secret', facts.absolute);
        if (facts.protected && program.redirects.includes(arg))
          return verdict('ask', 'protected', facts.absolute);
        if (facts.relative === undefined)
          return external(`path-outside-project:${facts.absolute}`);
      }
    }
  }
  if (effect.kind === 'mcp' && !effect.readOnly)
    return external(`mcp:${effect.server}/${effect.tool}`);
  if (effect.kind === 'network' && effect.method.toUpperCase() !== 'GET')
    return external(`network:${effect.url}`);

  // 5. Approved for this session (exact key only).
  if (ctx.sessionApprovals.has(base.sessionKey))
    return verdict('allow', 'session-approved');

  // 6. Allow rules: every program in the command must be covered.
  if (effect.kind === 'command') {
    const allow = ctx.rules.filter((r) => r.decision === 'allow');
    const covered = (argv: string[]) =>
      allow.some((r) => matchesPrefix(argv, r.prefix, windows));
    const all =
      programs.length > 0 ? programs.map((p) => p.argv) : [effect.argv];
    if (allow.length > 0 && all.every(covered))
      return verdict('allow', 'allow-rule');
  }

  // 7. The mode.
  const reading =
    effect.kind === 'read' ||
    (effect.kind === 'network' && effect.method.toUpperCase() === 'GET');
  if (ctx.mode === 'hands-off') return verdict('allow', 'mode');
  if (ctx.mode === 'ask-when-needed') {
    return effect.kind === 'network' && !reading
      ? verdict('ask', 'mode')
      : verdict('allow', 'mode');
  }
  // ask-always: reads and the safe list run; everything else asks. Fetching pages asks too.
  if (effect.kind === 'read') return verdict('allow', 'mode');
  if (effect.kind === 'command' && analysis?.kind === 'parsed') {
    const safe = (argv: string[]) =>
      ctx.safeList.some((prefix) => matchesPrefix(argv, prefix, windows));
    if (
      programs.length > 0 &&
      programs.every((p) => p.redirects.length === 0 && safe(p.argv))
    ) {
      return verdict('allow', 'safe-list');
    }
  }
  return verdict('ask', 'mode');
}

/** Built-in safe list: read-only git commands and the project's test/lint/typecheck/build scripts. */
export function builtInSafeList(
  packageScripts: Record<string, string> = {},
): string[][] {
  const list: string[][] = [
    ['git', 'status', '*'],
    ['git', 'diff', '*'],
    ['git', 'log', '*'],
    ['git', 'show', '*'],
    ['git', 'branch'],
    ['git', 'rev-parse', '*'],
  ];
  for (const script of ['test', 'lint', 'typecheck', 'build']) {
    if (script in packageScripts) {
      list.push(['npm', 'run', script, '*']);
      if (script === 'test') list.push(['npm', 'test', '*']);
    }
  }
  return list;
}
