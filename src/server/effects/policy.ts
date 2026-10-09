// The decision order (ADR 0019). First rule with a verdict wins:
// plan mode, deny rules, then the floors (secrets, protected paths, dangerous commands,
// outside actions). In hands-off only reading a secret is still a floor. A floor is
// passed by "allow for this conversation" (its category) or, for commands, an allow rule.
import path, { type PlatformPath } from 'node:path';
import { analyzeCommand, findDanger, programName } from './commands.ts';
import { contentHash } from './hash.ts';
import { classifyPath, pathLikeArgs } from './paths.ts';
import type { Decision, Effect, Mode, Reason, Rule, Verdict } from './types.ts';

export interface PolicyContext {
  projectRoot: string;
  mode: Mode;
  /** Plan mode for this conversation: only reads run until the user picks a plan. */
  planning: boolean;
  rules: Rule[];
  /** Categories the user allowed for this conversation (Verdict.grant). */
  grants: ReadonlySet<string>;
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

interface Floor {
  reason: 'secret' | 'protected' | 'dangerous' | 'external';
  detail: string;
  grant: string;
  /** Reading a secret asks even in hands-off. */
  secretRead?: boolean;
}

/** The first floor this action hits, if any. */
function floorOf(
  effect: Effect,
  ctx: PolicyContext,
  api: PlatformPath,
  programs: { argv: string[]; redirects: string[] }[],
): Floor | undefined {
  if (effect.kind === 'read' || effect.kind === 'write') {
    const facts = classifyPath(
      effect.path,
      ctx.projectRoot,
      ctx.projectRoot,
      api,
    );
    if (facts.secret || (effect.kind === 'read' && effect.secret))
      return effect.kind === 'read'
        ? {
            reason: 'secret',
            detail: facts.absolute,
            grant: 'secret:read',
            secretRead: true,
          }
        : { reason: 'secret', detail: facts.absolute, grant: 'secret:write' };
    if (effect.kind === 'write' && facts.protected)
      return {
        reason: 'protected',
        detail: facts.absolute,
        grant: 'protected:write',
      };
    if (facts.relative === undefined)
      return {
        reason: 'external',
        detail: `outside-project:${facts.absolute}`,
        grant: `external:outside-project:${effect.kind}`,
      };
    if (
      effect.kind === 'write' &&
      effect.operation === 'delete' &&
      ctx.existedBefore(facts.absolute)
    )
      return {
        reason: 'external',
        detail: `delete-existing:${facts.absolute}`,
        grant: 'external:delete-existing',
      };
    return undefined;
  }
  if (effect.kind === 'command') {
    const program = programName(programs[0]?.argv[0] ?? effect.argv[0] ?? '');
    const danger = findDanger(programs);
    if (danger)
      return {
        reason: 'dangerous',
        detail: danger,
        grant: `dangerous:${danger}`,
      };
    const cwd = classifyPath(effect.cwd, ctx.projectRoot, ctx.projectRoot, api);
    if (cwd.relative === undefined)
      return {
        reason: 'external',
        detail: `cwd-outside-project:${cwd.absolute}`,
        grant: `external:command:${program}`,
      };
    for (const p of programs) {
      for (const arg of [...pathLikeArgs(p.argv), ...p.redirects]) {
        const facts = classifyPath(arg, ctx.projectRoot, effect.cwd, api);
        const redirect = p.redirects.includes(arg);
        if (facts.secret)
          return redirect
            ? {
                reason: 'secret',
                detail: facts.absolute,
                grant: 'secret:write',
              }
            : {
                reason: 'secret',
                detail: facts.absolute,
                grant: 'secret:read',
                secretRead: true,
              };
        if (facts.protected && redirect)
          return {
            reason: 'protected',
            detail: facts.absolute,
            grant: 'protected:write',
          };
        if (facts.relative === undefined)
          return {
            reason: 'external',
            detail: `path-outside-project:${facts.absolute}`,
            grant: `external:command:${program}`,
          };
      }
    }
    return undefined;
  }
  if (effect.kind === 'mcp' && !effect.readOnly)
    return {
      reason: 'external',
      detail: `mcp:${effect.server}/${effect.tool}`,
      grant: `external:mcp:${effect.server}/${effect.tool}`,
    };
  return undefined;
}

export function decide(effect: Effect, ctx: PolicyContext): Verdict {
  const api = ctx.pathApi ?? path;
  const windows = api === path.win32;
  const hash = contentHash(effect);
  const verdict = (
    decision: Decision,
    reason: Reason,
    detail?: string,
    grant?: string,
  ): Verdict => ({
    decision,
    reason,
    contentHash: hash,
    ...(detail !== undefined ? { detail } : {}),
    ...(grant !== undefined ? { grant } : {}),
  });

  // The plan that ends plan mode is a question for the user; outside plan mode there is none.
  if (effect.kind === 'plan')
    return ctx.planning
      ? verdict('ask', 'plan')
      : verdict('deny', 'plan-mode', 'not-planning');

  // Every program a command really runs, after unwrapping. A command Rocky cannot
  // unwrap is judged by its outer argv only.
  const analysis =
    effect.kind === 'command' ? analyzeCommand(effect.argv) : undefined;
  const programs =
    analysis?.kind === 'parsed'
      ? analysis.commands
      : effect.kind === 'command'
        ? [{ argv: effect.argv, redirects: [] }]
        : [];

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

  // 2. Plan mode: only reads run.
  const reading =
    effect.kind === 'read' || (effect.kind === 'mcp' && effect.readOnly);
  if (ctx.planning && !reading) return verdict('deny', 'plan-mode');

  // 3. The floors.
  const floor = floorOf(effect, ctx, api, programs);
  if (!floor) return verdict('allow', 'mode');
  if (ctx.mode === 'hands-off' && !floor.secretRead)
    return verdict('allow', 'mode', floor.detail);
  if (ctx.grants.has(floor.grant))
    return verdict('allow', 'session-approved', floor.detail);
  // 4. Allow rules ("always allow"): every program in the command must be covered.
  if (effect.kind === 'command' && !floor.secretRead) {
    const allow = ctx.rules.filter((r) => r.decision === 'allow');
    if (
      allow.length > 0 &&
      programs.every((p) =>
        allow.some((r) => matchesPrefix(p.argv, r.prefix, windows)),
      )
    )
      return verdict('allow', 'allow-rule', floor.detail);
  }
  return verdict('ask', floor.reason, floor.detail, floor.grant);
}

/** The rule "always allow" saves for a command: its program and subcommand words (no
 * paths, flags or values, at most three) then "*", or the exact argv when that would be
 * only the program ("rm *" or "node *" would allow anything). */
export function alwaysRule(argv: string[]): string[] {
  const words: string[] = [];
  for (const arg of argv) {
    if (words.length === 3) break;
    // The program may be a full path (rules compare its name); later words must be plain.
    const plain =
      words.length === 0 || /^[\p{L}\p{N}][\p{L}\p{N}_:-]*$/u.test(arg);
    if (!plain) break;
    words.push(arg);
  }
  return words.length >= 2 && words.length < argv.length
    ? [...words, '*']
    : [...argv];
}
