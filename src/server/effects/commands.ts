// Command analysis for the action gate: unwrap wrappers (sudo, env, sh -c, cmd /c,
// powershell -Command ...) up to four levels, split compound strings, and flag
// dangerous programs. Works on tokens, never on the raw command string.

export interface SimpleCommand {
  argv: string[];
  /** Redirect targets (`> file`), which are writes. */
  redirects: string[];
  /** Split out of a string a shell runs, which expands words like ~, $VAR (and %VAR% for
   * cmd) before the program sees them: such words are not the literal paths they look like. */
  shell?: 'posix' | 'cmd' | 'powershell';
}

export type Analysis =
  | { kind: 'parsed'; commands: SimpleCommand[] }
  | { kind: 'unparseable'; reason: string };

const MAX_DEPTH = 4;

/** Program name without directory or Windows executable extension, lower-cased. */
export function programName(token: string): string {
  const base = token.split(/[\\/]/).pop() ?? token;
  return base.replace(/\.(exe|cmd|bat|com|ps1)$/i, '').toLowerCase();
}

/**
 * POSIX-style word splitting with quotes; returns undefined for constructs we do not model.
 * literalBackslash: a backslash is an ordinary character (a Windows path separator), not an escape.
 */
export function splitPosix(
  text: string,
  { literalBackslash = false }: { literalBackslash?: boolean } = {},
): string[][] | undefined {
  const commands: string[][] = [[]];
  let word = '';
  let inWord = false;
  let quote: '"' | "'" | null = null;
  const push = () => {
    if (inWord) commands.at(-1)!.push(word);
    word = '';
    inWord = false;
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quote) {
      if (c === quote) quote = null;
      else if (
        quote === '"' &&
        (c === '`' || (c === '$' && text[i + 1] === '('))
      )
        return undefined;
      else if (
        quote === '"' &&
        c === '\\' &&
        !literalBackslash &&
        i + 1 < text.length
      )
        word += text[++i];
      else word += c;
      continue;
    }
    if (c === "'" || c === '"') {
      quote = c;
      inWord = true;
    } else if (
      c === '`' ||
      (c === '$' && text[i + 1] === '(') ||
      (c === '<' && text[i + 1] === '(')
    ) {
      return undefined;
    } else if (c === '\\' && !literalBackslash && i + 1 < text.length) {
      word += text[++i];
      inWord = true;
    } else if (/\s/.test(c)) {
      push();
    } else if (c === ';' || c === '&' || c === '|' || c === '\n') {
      push();
      if ((c === '&' || c === '|') && text[i + 1] === c) i++;
      if (commands.at(-1)!.length > 0) commands.push([]);
    } else if (c === '>' || c === '<') {
      push();
      const op = text[i + 1] === '>' ? (i++, '>>') : c;
      commands.at(-1)!.push(op);
    } else {
      word += c;
      inWord = true;
    }
  }
  if (quote) return undefined;
  push();
  return commands.filter((argv) => argv.length > 0);
}

/** cmd.exe-style splitting: double quotes only, `&`, `&&`, `||`, `|` separate commands. */
export function splitCmd(text: string): string[][] | undefined {
  if (/%[^%\s]+%|![^!\s]+!/.test(text) && /\(|\)/.test(text)) return undefined;
  const commands: string[][] = [[]];
  let word = '';
  let inWord = false;
  let quoted = false;
  const push = () => {
    if (inWord) commands.at(-1)!.push(word);
    word = '';
    inWord = false;
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (c === '"') {
      quoted = !quoted;
      inWord = true;
    } else if (!quoted && c === '^' && i + 1 < text.length) {
      word += text[++i];
      inWord = true;
    } else if (!quoted && /\s/.test(c)) {
      push();
    } else if (!quoted && (c === '&' || c === '|')) {
      push();
      if (text[i + 1] === c) i++;
      if (commands.at(-1)!.length > 0) commands.push([]);
    } else if (!quoted && c === '>') {
      push();
      if (text[i + 1] === '>') i++;
      commands.at(-1)!.push('>');
    } else {
      word += c;
      inWord = true;
    }
  }
  if (quoted) return undefined;
  push();
  return commands.filter((argv) => argv.length > 0);
}

/** PowerShell statements: quotes, `;`, `|`, `&&`, `||`; script blocks and subexpressions are
 * not modelled. A backslash is a path separator there (its escape is the backquote). */
export function splitPowerShell(text: string): string[][] | undefined {
  if (/\$\(|\{|\}|@\(/.test(text)) return undefined;
  return splitPosix(text.replace(/`/g, ''), { literalBackslash: true });
}

function decodePowerShellBase64(encoded: string): string | undefined {
  try {
    return Buffer.from(encoded, 'base64').toString('utf16le');
  } catch {
    return undefined;
  }
}

/** Interpreters given inline code: the code itself cannot be judged. */
const INLINE_CODE: Record<string, string[]> = {
  node: ['-e', '--eval', '-p', '--print'],
  python: ['-c'],
  python3: ['-c'],
  py: ['-c'],
  perl: ['-e', '-E'],
  ruby: ['-e'],
  deno: ['eval'],
  bun: ['-e', '--eval'],
};

/** Stands in for a `$(...)` or backquoted command whose output the shell inserts. */
export const SUBSTITUTED = '$SUBSTITUTED';

/**
 * Pulls command substitutions (`$(...)`, backquotes) out of a shell string so both the outer
 * command and every inner command can be judged. Single quotes keep them literal. Undefined
 * when they are not balanced.
 */
export function substitutions(
  text: string,
): { text: string; inner: string[] } | undefined {
  const inner: string[] = [];
  let out = '';
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quote === "'") {
      if (c === "'") quote = null;
      out += c;
      continue;
    }
    if (c === '\\' && i + 1 < text.length) {
      out += c + text[++i];
      continue;
    }
    if (c === "'" && !quote) quote = "'";
    else if (c === '"') quote = quote === '"' ? null : '"';
    if (c === '$' && text[i + 1] === '(') {
      let depth = 1;
      let j = i + 2;
      let q: '"' | "'" | null = null;
      for (; j < text.length && depth > 0; j++) {
        const d = text[j]!;
        if (q) {
          if (d === q) q = null;
        } else if (d === "'" || d === '"') q = d;
        else if (d === '(') depth++;
        else if (d === ')') depth--;
      }
      if (depth !== 0) return undefined;
      inner.push(text.slice(i + 2, j - 1));
      out += SUBSTITUTED;
      i = j - 1;
      continue;
    }
    if (c === '`') {
      const end = text.indexOf('`', i + 1);
      if (end === -1) return undefined;
      inner.push(text.slice(i + 1, end));
      out += SUBSTITUTED;
      i = end;
      continue;
    }
    out += c;
  }
  return quote ? undefined : { text: out, inner };
}

function withRedirects(argv: string[]): SimpleCommand {
  const words: string[] = [];
  const redirects: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]!;
    if ((token === '>' || token === '>>') && i + 1 < argv.length)
      redirects.push(argv[++i]!);
    else if (token === '<' && i + 1 < argv.length) i++;
    else words.push(token);
  }
  return { argv: words, redirects };
}

function unwrap(argv: string[], depth: number): Analysis {
  if (depth > MAX_DEPTH)
    return { kind: 'unparseable', reason: 'nested-too-deep' };
  if (argv.length === 0) return { kind: 'parsed', commands: [] };
  const name = programName(argv[0]!);
  const rest = argv.slice(1);
  // Commands split out of a string the shell runs: their words are shell-expanded.
  const nested = (
    splits: string[][] | undefined,
    reason: string,
    shell: 'posix' | 'cmd' | 'powershell',
    substituted: string[] = [],
  ): Analysis => {
    if (!splits) return { kind: 'unparseable', reason };
    const commands: SimpleCommand[] = [];
    for (const inner of [
      ...splits,
      ...substituted.map((s) => ['sh', '-c', s]),
    ]) {
      const result = unwrap(inner, depth + 1);
      if (result.kind === 'unparseable') return result;
      commands.push(...result.commands);
    }
    return {
      kind: 'parsed',
      // A command from an inner string keeps the innermost shell that split it.
      commands: commands.map((c) => ({ ...c, shell: c.shell ?? shell })),
    };
  };

  if (
    [
      'sudo',
      'doas',
      'nohup',
      'time',
      'nice',
      'ionice',
      'command',
      'exec',
    ].includes(name)
  ) {
    const i = rest.findIndex((t) => !t.startsWith('-'));
    return i === -1
      ? { kind: 'parsed', commands: [] }
      : unwrap(rest.slice(i), depth + 1);
  }
  if (name === 'env') {
    const i = rest.findIndex((t) => !t.startsWith('-') && !/^\w+=/.test(t));
    return i === -1
      ? { kind: 'parsed', commands: [] }
      : unwrap(rest.slice(i), depth + 1);
  }
  if (['sh', 'bash', 'zsh', 'dash', 'ksh', 'fish'].includes(name)) {
    const c = rest.findIndex((t) => /^-\w*c\w*$/.test(t));
    if (c === -1)
      return rest.length === 0
        ? { kind: 'parsed', commands: [withRedirects(argv)] }
        : { kind: 'unparseable', reason: 'shell-script' };
    const string = substitutions(rest[c + 1] ?? '');
    return string
      ? nested(splitPosix(string.text), 'shell-string', 'posix', string.inner)
      : { kind: 'unparseable', reason: 'shell-string' };
  }
  if (name === 'cmd') {
    const c = rest.findIndex((t) => /^\/[ck]$/i.test(t));
    if (c === -1) return { kind: 'parsed', commands: [withRedirects(argv)] };
    return nested(splitCmd(rest.slice(c + 1).join(' ')), 'cmd-string', 'cmd');
  }
  if (name === 'powershell' || name === 'pwsh') {
    const enc = rest.findIndex((t) => /^-(e|ec|encodedcommand)$/i.test(t));
    if (enc !== -1) {
      const decoded = decodePowerShellBase64(rest[enc + 1] ?? '');
      return nested(
        decoded === undefined ? undefined : splitPowerShell(decoded),
        'powershell-encoded',
        'powershell',
      );
    }
    const c = rest.findIndex((t) => /^-(c|command)$/i.test(t));
    if (c !== -1)
      return nested(
        splitPowerShell(rest.slice(c + 1).join(' ')),
        'powershell-string',
        'powershell',
      );
    if (rest.some((t) => /^-(f|file)$/i.test(t)))
      return { kind: 'unparseable', reason: 'script-file' };
    return { kind: 'parsed', commands: [withRedirects(argv)] };
  }
  const inline = INLINE_CODE[name];
  if (inline && rest.some((t) => inline.includes(t)))
    return { kind: 'unparseable', reason: 'inline-code' };
  return { kind: 'parsed', commands: [withRedirects(argv)] };
}

/** Breaks an argv into the programs it actually runs. */
export function analyzeCommand(argv: string[]): Analysis {
  return unwrap(argv, 0);
}

const has = (argv: string[], ...flags: string[]) =>
  argv.some((t) => flags.some((f) => t.toLowerCase() === f.toLowerCase()));
const hasShortFlag = (argv: string[], letter: string) =>
  argv.some((t) => /^-[a-zA-Z]+$/.test(t) && t.includes(letter));
const psFlag = (argv: string[], name: string) =>
  argv.some(
    (t) =>
      t.startsWith('-') &&
      name.toLowerCase().startsWith(t.slice(1).toLowerCase()) &&
      t.length > 2,
  );

/** Why a single command is dangerous, or undefined. Names are matched case-insensitively. */
export function dangerReason(
  command: SimpleCommand,
  next?: SimpleCommand,
): string | undefined {
  const argv = command.argv;
  const name = programName(argv[0] ?? '');
  const args = argv.slice(1);
  switch (name) {
    case 'rm':
      if (
        hasShortFlag(args, 'r') ||
        hasShortFlag(args, 'R') ||
        has(args, '--recursive')
      )
        return 'recursive-delete';
      if (args.some((a) => a === '/' || a === '~' || a === '*'))
        return 'broad-delete';
      return undefined;
    case 'rmdir':
    case 'rd':
      return has(args, '/s') || psFlag(args, 'Recurse')
        ? 'recursive-delete'
        : undefined;
    case 'del':
    case 'erase':
      return has(args, '/s', '/q', '/f') ||
        psFlag(args, 'Recurse') ||
        psFlag(args, 'Force')
        ? 'recursive-delete'
        : undefined;
    case 'remove-item':
    case 'ri':
      return psFlag(args, 'Recurse') || psFlag(args, 'Force')
        ? 'recursive-delete'
        : undefined;
    case 'dd':
      return args.some((a) => a.startsWith('of='))
        ? 'raw-disk-write'
        : undefined;
    case 'mkfs':
    case 'format':
    case 'format-volume':
    case 'clear-disk':
    case 'initialize-disk':
    case 'diskpart':
    case 'bcdedit':
    case 'fdisk':
    case 'parted':
      return 'disk';
    case 'shutdown':
    case 'reboot':
    case 'halt':
    case 'poweroff':
    case 'stop-computer':
    case 'restart-computer':
      return 'power';
    case 'chmod':
    case 'chown':
    case 'icacls':
    case 'takeown':
      return hasShortFlag(args, 'R') || has(args, '/t', '/r', '--recursive')
        ? 'recursive-permissions'
        : undefined;
    case 'reg':
      return has(args, 'delete', 'add', 'import') ? 'registry' : undefined;
    case 'vssadmin':
    case 'wbadmin':
    case 'cipher':
      return 'system-tool';
    case 'wmic':
      return has(args, 'delete', 'call') ? 'system-tool' : undefined;
    case 'invoke-expression':
    case 'iex':
      return 'dynamic-code';
    case 'set-executionpolicy':
      return 'security-setting';
    case 'netsh':
      return has(args, 'advfirewall', 'firewall')
        ? 'security-setting'
        : undefined;
    case 'git': {
      // The subcommand is the first word after git's own options (-C dir, -c key=value, ...);
      // only its own arguments count, so "git stash push" or "git commit -m push" is no push.
      let s = 0;
      while (s < args.length && args[s]!.startsWith('-')) {
        s +=
          /^(-C|-c|--git-dir|--work-tree|--namespace|--exec-path|--config-env)$/.test(
            args[s]!,
          )
            ? 2
            : 1;
      }
      const sub = (args[s] ?? '').toLowerCase();
      const own = args.slice(s + 1);
      if (sub === 'push')
        return hasShortFlag(own, 'f') ||
          own.some((a) => /^--force/i.test(a) || a.startsWith('+'))
          ? 'force-push'
          : // Any push leaves the computer and cannot be taken back.
            'push';
      if (sub === 'reset' && has(own, '--hard')) return 'discard-changes';
      if (sub === 'clean' && own.some((a) => /^-[a-z]*f/.test(a)))
        return 'discard-changes';
      if (
        (sub === 'checkout' || sub === 'restore') &&
        (has(own, '.', '--', '--force') || hasShortFlag(own, 'f'))
      )
        return 'discard-changes';
      return undefined;
    }
    case 'find':
      return has(args, '-delete') || has(args, '-exec')
        ? 'find-delete-or-exec'
        : undefined;
    case 'curl':
    case 'wget':
    case 'invoke-webrequest':
    case 'iwr':
    case 'irm':
    case 'invoke-restmethod': {
      const nextName = next ? programName(next.argv[0] ?? '') : '';
      return [
        'sh',
        'bash',
        'zsh',
        'powershell',
        'pwsh',
        'iex',
        'invoke-expression',
        'python',
        'node',
        'cmd',
      ].includes(nextName)
        ? 'pipe-to-interpreter'
        : undefined;
    }
    default:
      return undefined;
  }
}

/** Every danger among the commands, in order. */
export function findDangers(commands: SimpleCommand[]): string[] {
  const found: string[] = [];
  for (let i = 0; i < commands.length; i++) {
    const reason = dangerReason(commands[i]!, commands[i + 1]);
    if (reason && !found.includes(reason)) found.push(reason);
  }
  return found;
}

/** The first dangerous program among the commands, if any. */
export function findDanger(commands: SimpleCommand[]): string | undefined {
  return findDangers(commands)[0];
}
