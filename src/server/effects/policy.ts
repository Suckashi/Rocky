// The decision order (ADR 0019, 0028). First rule with a verdict wins:
// plan mode, deny rules, then the floors (secrets, protected paths, dangerous commands,
// outside actions). In hands-off only reading a secret is still a floor. Every floor an
// action hits must be passed, each by "allow for this conversation" (its category); for
// commands an allow rule passes them all except a secret read.
import path, { type PlatformPath } from 'node:path';
import {
  analyzeCommand,
  findDangers,
  programName,
  SUBSTITUTED,
  withoutExpansions,
  type Shell,
  type SimpleCommand,
} from './commands.ts';
import { contentHash } from './hash.ts';
import {
  classifyPath,
  globNamesSecret,
  namesProtected,
  namesSecret,
  pathLikeArgs,
  privateFiles,
} from './paths.ts';
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
  /** Rocky's own secret files (the model key and MCP tokens, the API token): secrets
   * wherever the project is. */
  privateFiles?: readonly string[];
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

/** How much a floor matters when one action hits several: a secret read must never hide
 * behind a dangerous or outside floor (which hands-off and grants let through). */
function weight(floor: Floor): number {
  if (floor.secretRead) return 5;
  if (floor.reason === 'secret') return 4;
  if (floor.reason === 'protected') return 3;
  if (floor.reason === 'dangerous') return 2;
  return 1;
}

function strongest(floors: Floor[]): Floor | undefined {
  let best: Floor | undefined;
  for (const f of floors) if (!best || weight(f) > weight(best)) best = f;
  return best;
}

/** What a shell replaces at the start of a word before the program sees it: ~ and $VAR
 * (and a substitution, see SUBSTITUTED), %VAR% in cmd. A `$` later in a word, or in a
 * single-quoted word, is literal (sed patterns, awk programs, printf formats). */
const EXPANSION: Record<Shell, RegExp> = {
  posix: /^(?:~[\w.-]*(?=$|\/)|\$\{\w+\}|\$\w+)/,
  powershell: /^(?:~(?=$|[\\/])|\$\{[^}]+\}|\$(?:env:)?\w+)/i,
  cmd: /^%\w+%/,
};

/** The current folder, which the shell puts in place of $PWD. */
const CURRENT = /^\$(?:\{PWD\}|PWD)(?=$|[\\/])/;

/** Programs whose plain words are files, so even a bare `$HOME` is a target. */
const FILE_PROGRAMS = new Set([
  'cd',
  'pushd',
  'chdir',
  'set-location',
  'sl',
  'push-location',
  'cat',
  'cp',
  'mv',
  'rm',
  'rmdir',
  'mkdir',
  'touch',
  'ln',
  'tee',
  'chmod',
  'chown',
  'install',
  'rsync',
  'scp',
  'tar',
  'zip',
  'unzip',
  'dd',
  'truncate',
  'shred',
  'ls',
  'dir',
  'find',
  'grep',
  'egrep',
  'fgrep',
  'rg',
  'du',
  'tree',
  'head',
  'tail',
  'less',
  'more',
  'wc',
  'stat',
  'file',
  'diff',
  'cmp',
  'code',
  'open',
  'xdg-open',
  'copy',
  'move',
  'del',
  'erase',
  'ren',
  'rename',
  'md',
  'rd',
  'type',
  'xcopy',
  'robocopy',
  'copy-item',
  'move-item',
  'remove-item',
  'new-item',
  'set-content',
  'add-content',
  'out-file',
  'get-content',
  'get-childitem',
  'gci',
  'select-string',
  'sls',
]);

/** Programs that change the folder later commands run in; alone, `cd` goes home. */
const CHANGES_DIRECTORY = new Set([
  'cd',
  'pushd',
  'chdir',
  'set-location',
  'sl',
  'push-location',
]);

/** Names that are no files: discarded output, the terminal. */
const NOT_FILES = /^(?:\/dev\/(?:null|stdout|stderr|tty|fd\/\d+)|nul|con)$/i;

/** Every floor this action hits; each must be passed before it runs. */
function floorsOf(
  effect: Effect,
  ctx: PolicyContext,
  api: PlatformPath,
  programs: SimpleCommand[],
): Floor[] {
  const own = privateFiles(ctx.privateFiles ?? [], api);
  const secretFloor = (detail: string, write: boolean): Floor =>
    write
      ? { reason: 'secret', detail, grant: 'secret:write' }
      : { reason: 'secret', detail, grant: 'secret:read', secretRead: true };
  if (effect.kind === 'read' || effect.kind === 'write') {
    const facts = classifyPath(
      effect.path,
      ctx.projectRoot,
      ctx.projectRoot,
      api,
    );
    const floors: Floor[] = [];
    if (
      facts.secret ||
      own.has(facts.absolute) ||
      (effect.kind === 'read' && effect.secret)
    )
      floors.push(secretFloor(facts.absolute, effect.kind === 'write'));
    if (effect.kind === 'write' && facts.protected)
      floors.push({
        reason: 'protected',
        detail: facts.absolute,
        grant: 'protected:write',
      });
    if (facts.relative === undefined)
      floors.push({
        reason: 'external',
        detail: `outside-project:${facts.absolute}`,
        grant: `external:outside-project:${effect.kind}`,
      });
    else if (
      effect.kind === 'write' &&
      effect.operation === 'delete' &&
      ctx.existedBefore(facts.absolute)
    )
      floors.push({
        reason: 'external',
        detail: `delete-existing:${facts.absolute}`,
        grant: 'external:delete-existing',
      });
    return floors;
  }
  if (effect.kind === 'command') {
    const floors: Floor[] = [];
    const seen = new Set<string>();
    const push = (floor: Floor) => {
      const key = `${floor.grant}\0${floor.detail}`;
      if (seen.has(key)) return;
      seen.add(key);
      floors.push(floor);
    };
    for (const danger of findDangers(programs))
      push({
        reason: 'dangerous',
        detail: danger,
        grant: `dangerous:${danger}`,
      });
    const cwd = classifyPath(effect.cwd, ctx.projectRoot, ctx.projectRoot, api);
    // A command run in a secret folder (~/.ssh) reads it.
    if (cwd.secret) push(secretFloor(cwd.absolute, false));
    /** The folder the next program runs in; undefined after a cd Rocky cannot follow. */
    let folder: string | undefined = effect.cwd;
    // Every path of every program counts; the grant names the program that hit the floor.
    for (const p of programs) {
      const program = programName(p.argv[0] ?? '') || 'shell';
      const external = (detail: string) =>
        push({
          reason: 'external',
          detail,
          grant: `external:command:${program}`,
        });
      const here: string | undefined = p.elsewhere ? undefined : folder;
      if (p.argv.length > 0) {
        if (here === undefined) external('unknown-folder');
        else if (
          classifyPath(here, ctx.projectRoot, ctx.projectRoot, api).relative ===
          undefined
        )
          external(`cwd-outside-project:${here}`);
      }
      const base = here ?? effect.cwd;
      const shell = p.shell;
      /** The start the shell replaces in a word, if any. */
      const replaced = (word: string, value: boolean) =>
        shell &&
        (shell === 'cmd' || value || (p.expanding ?? []).includes(word))
          ? EXPANSION[shell].exec(word)?.[0]
          : undefined;
      const fileProgram = FILE_PROGRAMS.has(program);
      const changesFolder = CHANGES_DIRECTORY.has(program);
      const operands = p.argv.slice(1).filter((a) => !a.startsWith('-'));
      if (shell && shell !== 'cmd' && changesFolder && operands.length === 0)
        external('cd-home');
      // What each word is: a file the shell writes or reads, or a word the program gets.
      type Role = 'write' | 'read' | 'arg' | 'value';
      const words: [string, Role][] = [
        ...p.redirects.map((w): [string, Role] => [w, 'write']),
        ...(p.inputs ?? []).map((w): [string, Role] => [w, 'read']),
        ...(p.values ?? []).map((w): [string, Role] => [w, 'value']),
        ...p.argv.slice(1).flatMap((w): [string, Role][] =>
          p.opaque
            ? // Code Rocky cannot follow: any word in it may be a path.
              w
                .split(/[\s'"`$(){};|&<>,=]+/)
                .filter(Boolean)
                .map((t): [string, Role] => [t, 'arg'])
            : w.startsWith('-')
              ? w.includes('=')
                ? [[w.slice(w.indexOf('=') + 1), 'arg']]
                : []
              : [[w.replace(/^@/, ''), 'arg']],
        ),
      ];
      const pathLike = new Set(pathLikeArgs(['', ...words.map(([w]) => w)]));
      for (const [raw, role] of words) {
        if (!raw || NOT_FILES.test(raw) || raw.includes('://')) continue;
        const write = role === 'write';
        let word = raw;
        if (shell && CURRENT.test(word))
          word = base + word.replace(CURRENT, '');
        const start =
          word === raw ? replaced(word, role === 'value') : undefined;
        if (start !== undefined) {
          // Where it points is unknown: outside the project as far as Rocky can tell, and a
          // secret or protected file when the rest of the path names one. A bare
          // substitution given to a program is a list of words (judged inside), not a place.
          const bare = start === word;
          if (
            role !== 'arg' ||
            !bare ||
            /^~/.test(start) ||
            (fileProgram && (start !== SUBSTITUTED || changesFolder))
          )
            external(`shell-expanded-path:${raw}`);
          const rest = word.slice(start.length);
          if (namesSecret(rest, api) || (rest && own.named(rest)))
            push(secretFloor(raw, write));
          if (write && namesProtected(rest))
            push({
              reason: 'protected',
              detail: raw,
              grant: 'protected:write',
            });
          continue;
        }
        const facts = classifyPath(word, ctx.projectRoot, base, api);
        // A variable or substitution inside a word may be empty: judge the word without it too.
        const plain = shell ? withoutExpansions(word) : word;
        const plainFacts =
          plain !== word && plain
            ? classifyPath(plain, ctx.projectRoot, base, api)
            : undefined;
        if (
          [facts, plainFacts].some(
            (f) => f && (f.secret || own.has(f.absolute)),
          ) ||
          globNamesSecret(word, api)
        )
          push(secretFloor(facts.absolute, write));
        if (write && facts.protected)
          push({
            reason: 'protected',
            detail: facts.absolute,
            grant: 'protected:write',
          });
        // A plain word (a message, a script name) is only a path when it looks like one.
        if (
          facts.relative === undefined &&
          (role === 'write' || role === 'read' || pathLike.has(raw))
        )
          external(`path-outside-project:${facts.absolute}`);
      }
      // cd changes the folder of the commands after it; to where, when Rocky can tell.
      if (changesFolder || program === 'popd' || program === 'pop-location') {
        const target = operands[0];
        const known: string | false | undefined =
          here !== undefined &&
          target !== undefined &&
          target !== '-' &&
          changesFolder &&
          (shell && CURRENT.test(target)
            ? here + target.replace(CURRENT, '')
            : replaced(target, false) === undefined && !/[$`]/.test(target)
              ? target
              : undefined);
        folder = known
          ? classifyPath(known, ctx.projectRoot, here, api).absolute
          : undefined;
      }
    }
    return floors;
  }
  if (effect.kind === 'mcp' && !effect.readOnly)
    return [
      {
        reason: 'external',
        detail: `mcp:${effect.server}/${effect.tool}`,
        grant: `external:mcp:${effect.server}/${effect.tool}`,
      },
    ];
  // Starting a job hands work to another agent: an outside action, asked like one.
  if (effect.kind === 'delegate')
    return [
      {
        reason: 'external',
        detail: `delegate:${effect.agent}`,
        grant: `external:delegate:${effect.agent}`,
      },
    ];
  return [];
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
  // follow is judged by its outer argv and the words in it.
  const analysis =
    effect.kind === 'command' ? analyzeCommand(effect.argv) : undefined;
  const programs: SimpleCommand[] =
    analysis?.kind === 'parsed'
      ? analysis.commands
      : effect.kind === 'command'
        ? [{ argv: effect.argv, redirects: [], opaque: true }]
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

  // 3. The floors. Every one must be passed: hands-off passes all but a secret read, and
  // "allow for this conversation" passes its own category only.
  const floors = floorsOf(effect, ctx, api, programs);
  if (floors.length === 0) return verdict('allow', 'mode');
  const byMode = (f: Floor) => ctx.mode === 'hands-off' && !f.secretRead;
  // Allowing force pushes for the conversation allows plain pushes too.
  const granted = (f: Floor) =>
    ctx.grants.has(f.grant) ||
    (f.grant === 'dangerous:push' && ctx.grants.has('dangerous:force-push'));
  const open = floors.filter((f) => !byMode(f) && !granted(f));
  if (open.length === 0)
    return verdict(
      'allow',
      floors.every(byMode) ? 'mode' : 'session-approved',
      strongest(floors)!.detail,
    );
  const floor = strongest(open)!;
  // 4. Allow rules ("always allow"): every program in the command must be covered, or a
  // rule without * names this exact command (what "always allow" saves for `sh -c ...`).
  if (effect.kind === 'command' && !open.some((f) => f.secretRead)) {
    const allow = ctx.rules.filter((r) => r.decision === 'allow');
    const covered = (argv: string[]) =>
      allow.some((r) => matchesPrefix(argv, r.prefix, windows));
    if (
      allow.length > 0 &&
      (allow.some(
        (r) =>
          !r.prefix.includes('*') &&
          matchesPrefix(effect.argv, r.prefix, windows),
      ) ||
        programs.every(
          (p) =>
            (p.argv.length === 0 &&
              p.redirects.length === 0 &&
              !p.inputs?.length) ||
            covered(p.argv),
        ))
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
