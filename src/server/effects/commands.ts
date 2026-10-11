// Command analysis for the action gate: split shell strings into commands (quotes, redirects,
// heredocs, substitutions), unwrap wrappers (sudo, env, sh -c, cmd /c, powershell -Command ...)
// up to four levels, and flag dangerous programs. Works on tokens, never on the raw string.

export type Shell = 'posix' | 'cmd' | 'powershell';

export interface SimpleCommand {
  argv: string[];
  /** Files the shell writes (`> file`). */
  redirects: string[];
  /** Files the shell reads into the program (`< file`). */
  inputs?: string[];
  /** Words the program sees indirectly (variable values, a shell string's $0, $1 ...):
   * judged as possible paths. */
  values?: string[];
  /** Split out of a string this shell runs. */
  shell?: Shell;
  /** Words whose start that shell replaces (~, $VAR, a substitution): not the literal paths
   * they look like. cmd's %VAR% is matched by its pattern instead. */
  expanding?: string[];
  /** Code Rocky cannot follow (inline code, a string it cannot split, nesting too deep):
   * judged by the words in it. */
  opaque?: true;
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

/** Stands in for a `$(...)`, backquoted or `<(...)` command whose output the shell inserts. */
export const SUBSTITUTED = '$SUBSTITUTED';

/** One command of a shell string, before its wrappers are unwrapped. */
export interface ShellCommand {
  argv: string[];
  redirects: string[];
  inputs: string[];
  expanding: string[];
}

export interface ShellSplit {
  commands: ShellCommand[];
  /** The commands inside substitutions, judged too. */
  inner: string[];
}

/** Words that open or close a compound command: at the start of a command they run nothing. */
const RESERVED = new Set([
  'if',
  'then',
  'else',
  'elif',
  'fi',
  'do',
  'done',
  'while',
  'until',
  'esac',
  '!',
  '{',
  '}',
]);

const fresh = (): ShellCommand => ({
  argv: [],
  redirects: [],
  inputs: [],
  expanding: [],
});

/** Index of the `)` closing a `$(` whose content starts at `from`, or -1. */
function closingParen(text: string, from: number): number {
  let depth = 1;
  let quote: '"' | "'" | null = null;
  for (let j = from; j < text.length; j++) {
    const d = text[j]!;
    if (quote) {
      if (d === quote) quote = null;
      else if (d === '\\' && quote === '"') j++;
    } else if (d === '\\') j++;
    else if (d === "'" || d === '"') quote = d;
    else if (d === '(') depth++;
    else if (d === ')' && --depth === 0) return j;
  }
  return -1;
}

/** Index of the backquote closing one whose content starts at `from`, or -1. */
function closingBackquote(text: string, from: number): number {
  for (let j = from; j < text.length; j++) {
    if (text[j] === '\\') j++;
    else if (text[j] === '`') return j;
  }
  return -1;
}

/** The substitutions in a heredoc body, which the shell runs when the delimiter is unquoted. */
function bodySubstitutions(body: string, inner: string[]): boolean {
  for (let i = 0; i < body.length; i++) {
    const c = body[i]!;
    if (c === '\\') i++;
    else if (c === '$' && body[i + 1] === '(') {
      const end = closingParen(body, i + 2);
      if (end === -1) return false;
      inner.push(body.slice(i + 2, end));
      i = end;
    } else if (c === '`') {
      const end = closingBackquote(body, i + 1);
      if (end === -1) return false;
      inner.push(body.slice(i + 1, end));
      i = end;
    }
  }
  return true;
}

/**
 * Splits a POSIX shell string into commands. Quotes group words; `;`, `&`, `|`, `&&`, `||`,
 * newlines and parentheses separate commands; `#` starts a comment. Redirects name files
 * (`> f` writes, `< f` reads; `2>&1`, heredocs and here-strings name none). `$(...)`,
 * backquotes and `<(...)` become SUBSTITUTED, with their commands in `inner`. Undefined when
 * a quote or substitution is not closed. literalBackslash: a backslash is an ordinary
 * character (a Windows path separator), not an escape.
 */
export function splitShell(
  text: string,
  { literalBackslash = false }: { literalBackslash?: boolean } = {},
): ShellSplit | undefined {
  const commands: ShellCommand[] = [];
  const inner: string[] = [];
  let cur = fresh();
  let word = '';
  let inWord = false;
  /** How the word's first character was written, which decides whether the shell expands it. */
  let start: 'plain' | 'single' | 'double' | 'escaped' | null = null;
  let quotedWord = false;
  let quote: '"' | "'" | null = null;
  /** What the next word is: an argument, or what a redirect operator takes. */
  let next:
    'arg' | 'write' | 'read' | 'dup' | 'skip' | 'heredoc' | 'heredoc-tabs' =
    'arg';
  const heredocs: { delim: string; tabs: boolean; expands: boolean }[] = [];

  const add = (s: string, how: NonNullable<typeof start>) => {
    if (word === '' && start === null) start = how;
    word += s;
    inWord = true;
  };
  const endWord = () => {
    if (!inWord) return;
    const w = word;
    const expands =
      (start === 'plain' && /^[~$]/.test(w)) ||
      (start === 'double' && w.startsWith('$'));
    const quoted = quotedWord;
    const target = next;
    word = '';
    inWord = false;
    start = null;
    quotedWord = false;
    next = 'arg';
    if (target === 'heredoc' || target === 'heredoc-tabs') {
      heredocs.push({
        delim: w,
        tabs: target === 'heredoc-tabs',
        expands: !quoted,
      });
      return;
    }
    if (target === 'skip' || (target === 'dup' && /^(\d+|-)$/.test(w))) return;
    if (target === 'write' || target === 'dup') cur.redirects.push(w);
    else if (target === 'read') cur.inputs.push(w);
    else if (cur.argv.length === 0 && !quoted && RESERVED.has(w)) return;
    else cur.argv.push(w);
    if (expands) cur.expanding.push(w);
  };
  const endCommand = () => {
    endWord();
    next = 'arg';
    if (cur.argv.length || cur.redirects.length || cur.inputs.length)
      commands.push(cur);
    cur = fresh();
  };
  /** At a newline: skip the bodies of the heredocs opened on the line just ended. */
  const skipBodies = (newline: number): number | undefined => {
    let pos = newline + 1;
    for (const doc of heredocs.splice(0)) {
      const from = pos;
      for (;;) {
        const nl = text.indexOf('\n', pos);
        const end = nl === -1 ? text.length : nl;
        const line = text.slice(pos, end);
        pos = end + 1;
        if ((doc.tabs ? line.replace(/^\t+/, '') : line) === doc.delim) {
          if (
            doc.expands &&
            !bodySubstitutions(text.slice(from, end - line.length), inner)
          )
            return undefined;
          break;
        }
        if (nl === -1) {
          if (doc.expands && !bodySubstitutions(text.slice(from), inner))
            return undefined;
          break;
        }
      }
    }
    return pos - 2;
  };

  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quote === "'") {
      if (c === "'") quote = null;
      else add(c, 'single');
      continue;
    }
    if (quote === '"') {
      if (c === '"') quote = null;
      else if (
        c === '\\' &&
        !literalBackslash &&
        i + 1 < text.length &&
        '$`"\\'.includes(text[i + 1]!)
      )
        add(text[++i]!, 'escaped');
      else if (c === '$' && text[i + 1] === '(') {
        const end = closingParen(text, i + 2);
        if (end === -1) return undefined;
        inner.push(text.slice(i + 2, end));
        add(SUBSTITUTED, 'double');
        i = end;
      } else if (c === '`') {
        const end = closingBackquote(text, i + 1);
        if (end === -1) return undefined;
        inner.push(text.slice(i + 1, end));
        add(SUBSTITUTED, 'double');
        i = end;
      } else add(c, 'double');
      continue;
    }
    if (c === "'" || c === '"') {
      quote = c;
      inWord = true;
      quotedWord = true;
    } else if (c === '\\' && !literalBackslash && i + 1 < text.length) {
      if (text[i + 1] === '\n') i++;
      else {
        add(text[++i]!, 'escaped');
        quotedWord = true;
      }
    } else if (
      (c === '$' || c === '<' || c === '>') &&
      text[i + 1] === '(' &&
      (c === '$' || !inWord)
    ) {
      // $(...) is the command's output; <(...) and >(...) are a file connected to it.
      const end = closingParen(text, i + 2);
      if (end === -1) return undefined;
      inner.push(text.slice(i + 2, end));
      add(SUBSTITUTED, 'plain');
      i = end;
    } else if (c === '`') {
      const end = closingBackquote(text, i + 1);
      if (end === -1) return undefined;
      inner.push(text.slice(i + 1, end));
      add(SUBSTITUTED, 'plain');
      i = end;
    } else if (c === '#' && !inWord) {
      const nl = text.indexOf('\n', i);
      i = (nl === -1 ? text.length : nl) - 1;
    } else if (c === '\n') {
      endCommand();
      if (heredocs.length > 0) {
        const resume = skipBodies(i);
        if (resume === undefined) return undefined;
        i = resume;
      }
    } else if (/\s/.test(c)) {
      endWord();
    } else if (c === ';' || c === '(' || c === ')') {
      endCommand();
    } else if (c === '|') {
      endCommand();
      if (text[i + 1] === '|' || text[i + 1] === '&') i++;
    } else if (c === '&') {
      if (text[i + 1] === '>') {
        // &> and &>> send both outputs to a file.
        endWord();
        i += text[i + 2] === '>' ? 2 : 1;
        next = 'write';
      } else {
        endCommand();
        if (text[i + 1] === '&') i++;
      }
    } else if (c === '<' || c === '>') {
      // A number right before names the file descriptor (2>&1, 2>log); it is no argument.
      if (inWord && !quotedWord && /^\d+$/.test(word)) {
        word = '';
        inWord = false;
        start = null;
      } else endWord();
      if (c === '<') {
        if (text.startsWith('<<<', i)) {
          i += 2;
          next = 'skip';
        } else if (text[i + 1] === '<') {
          i++;
          if (text[i + 1] === '-') i++;
          next = text[i] === '-' ? 'heredoc-tabs' : 'heredoc';
        } else if (text[i + 1] === '&') {
          i++;
          next = 'skip';
        } else if (text[i + 1] === '>') {
          i++;
          next = 'write';
        } else next = 'read';
      } else {
        if (text[i + 1] === '>' || text[i + 1] === '|') i++;
        if (text[i + 1] === '&') {
          i++;
          next = 'dup';
        } else next = 'write';
      }
    } else add(c, 'plain');
  }
  if (quote) return undefined;
  endCommand();
  return { commands, inner };
}

/** cmd.exe-style splitting: double quotes and ^ escapes; `&`, `&&`, `||`, `|` separate
 * commands; `>`, `>>` write and `<` reads (`2>&1` names no file). */
export function splitCmd(text: string): ShellSplit | undefined {
  if (/%[^%\s]+%|![^!\s]+!/.test(text) && /\(|\)/.test(text)) return undefined;
  const commands: ShellCommand[] = [];
  let cur = fresh();
  let word = '';
  let inWord = false;
  let quoted = false;
  let quotedWord = false;
  let next: 'arg' | 'write' | 'read' | 'dup' = 'arg';
  const endWord = () => {
    if (!inWord) return;
    const target = next;
    next = 'arg';
    if (target === 'dup' && /^\d+$/.test(word)) {
      // 2>&1: no file.
    } else if (target === 'write' || target === 'dup') cur.redirects.push(word);
    else if (target === 'read') cur.inputs.push(word);
    else cur.argv.push(word);
    word = '';
    inWord = false;
    quotedWord = false;
  };
  const endCommand = () => {
    endWord();
    next = 'arg';
    if (cur.argv.length || cur.redirects.length || cur.inputs.length)
      commands.push(cur);
    cur = fresh();
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (c === '"') {
      quoted = !quoted;
      inWord = true;
      quotedWord = true;
    } else if (!quoted && c === '^' && i + 1 < text.length) {
      word += text[++i];
      inWord = true;
    } else if (!quoted && /\s/.test(c)) {
      endWord();
    } else if (!quoted && (c === '&' || c === '|')) {
      endCommand();
      if (text[i + 1] === c) i++;
    } else if (!quoted && (c === '>' || c === '<')) {
      if (inWord && !quotedWord && /^\d+$/.test(word)) {
        word = '';
        inWord = false;
      } else endWord();
      if (c === '<') next = 'read';
      else {
        if (text[i + 1] === '>') i++;
        if (text[i + 1] === '&') {
          i++;
          next = 'dup';
        } else next = 'write';
      }
    } else {
      word += c;
      inWord = true;
    }
  }
  if (quoted) return undefined;
  endCommand();
  return { commands, inner: [] };
}

/** PowerShell statements: quotes, `;`, `|`, `&&`, `||`; script blocks and subexpressions are
 * not modelled. A backslash is a path separator there (its escape is the backquote). */
export function splitPowerShell(text: string): ShellSplit | undefined {
  if (/\$\(|\{|\}|@\(/.test(text)) return undefined;
  return splitShell(text.replace(/`/g, ''), { literalBackslash: true });
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

/** Leading `NAME=value` words set variables for the program; they are not the program. */
function assignments(argv: string[]): { values: string[]; rest: string[] } {
  let i = 0;
  while (i < argv.length && /^[A-Za-z_]\w*=/.test(argv[i]!)) i++;
  return {
    values: argv.slice(0, i).map((a) => a.slice(a.indexOf('=') + 1)),
    rest: argv.slice(i),
  };
}

function unwrap(argv: string[], depth: number): Analysis {
  if (depth > MAX_DEPTH)
    return { kind: 'unparseable', reason: 'nested-too-deep' };
  const { values, rest } = assignments(argv);
  const result = unwrapProgram(rest, depth);
  if (values.length === 0 || result.kind === 'unparseable') return result;
  const [first, ...others] = result.commands;
  return {
    kind: 'parsed',
    commands: [
      first
        ? { ...first, values: [...(first.values ?? []), ...values] }
        : { argv: [], redirects: [], values },
      ...others,
    ],
  };
}

/** The commands in a string a shell runs. A part Rocky cannot follow is kept as opaque and
 * judged by its words; the other parts are judged as usual. */
function nested(
  split: ShellSplit | undefined,
  reason: string,
  shell: Shell,
  depth: number,
  positional: string[] = [],
): Analysis {
  if (!split) return { kind: 'unparseable', reason };
  const commands: SimpleCommand[] = [];
  const follow = (argv: string[]): SimpleCommand[] => {
    const result = unwrap(argv, depth + 1);
    return result.kind === 'parsed'
      ? result.commands
      : [{ argv, redirects: [], opaque: true }];
  };
  for (const part of split.commands) {
    // Commands from a deeper string keep that string's shell; these are this one's.
    const found = follow(part.argv).map((c) =>
      c.shell ? c : { ...c, shell, expanding: part.expanding },
    );
    if (part.redirects.length > 0 || part.inputs.length > 0) {
      const own = found[0] && found[0].expanding === part.expanding;
      const target = own
        ? found[0]!
        : { argv: [], redirects: [], shell, expanding: part.expanding };
      const files = {
        ...target,
        redirects: [...target.redirects, ...part.redirects],
        inputs: [...(target.inputs ?? []), ...part.inputs],
      };
      if (own) found[0] = files;
      else found.unshift(files);
    }
    commands.push(...found);
  }
  for (const text of split.inner) commands.push(...follow(['sh', '-c', text]));
  // A shell string's own arguments ($0, $1 ...) are literal words.
  if (positional.length > 0)
    commands.push({ argv: [], redirects: [], values: positional });
  return { kind: 'parsed', commands };
}

function unwrapProgram(argv: string[], depth: number): Analysis {
  if (argv.length === 0) return { kind: 'parsed', commands: [] };
  const name = programName(argv[0]!);
  const rest = argv.slice(1);
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
    const i = rest.findIndex((t) => !t.startsWith('-'));
    return i === -1
      ? { kind: 'parsed', commands: [] }
      : unwrap(rest.slice(i), depth + 1);
  }
  if (['sh', 'bash', 'zsh', 'dash', 'ksh', 'fish'].includes(name)) {
    const c = rest.findIndex((t) => /^-\w*c\w*$/.test(t));
    if (c === -1)
      return rest.length === 0
        ? { kind: 'parsed', commands: [{ argv, redirects: [] }] }
        : { kind: 'unparseable', reason: 'shell-script' };
    return nested(
      splitShell(rest[c + 1] ?? ''),
      'shell-string',
      'posix',
      depth,
      rest.slice(c + 2),
    );
  }
  if (name === 'cmd') {
    const c = rest.findIndex((t) => /^\/[ck]$/i.test(t));
    if (c === -1)
      return { kind: 'parsed', commands: [{ argv, redirects: [] }] };
    return nested(
      splitCmd(rest.slice(c + 1).join(' ')),
      'cmd-string',
      'cmd',
      depth,
    );
  }
  if (name === 'powershell' || name === 'pwsh') {
    const enc = rest.findIndex((t) => /^-(e|ec|encodedcommand)$/i.test(t));
    if (enc !== -1) {
      const decoded = decodePowerShellBase64(rest[enc + 1] ?? '');
      return nested(
        decoded === undefined ? undefined : splitPowerShell(decoded),
        'powershell-encoded',
        'powershell',
        depth,
      );
    }
    const c = rest.findIndex((t) => /^-(c|command)$/i.test(t));
    if (c !== -1)
      return nested(
        splitPowerShell(rest.slice(c + 1).join(' ')),
        'powershell-string',
        'powershell',
        depth,
      );
    if (rest.some((t) => /^-(f|file)$/i.test(t)))
      return { kind: 'unparseable', reason: 'script-file' };
    return { kind: 'parsed', commands: [{ argv, redirects: [] }] };
  }
  const inline = INLINE_CODE[name];
  if (inline && rest.some((t) => inline.includes(t)))
    return { kind: 'unparseable', reason: 'inline-code' };
  // A program given argv directly: every word is an argument (no shell, no redirects).
  return { kind: 'parsed', commands: [{ argv, redirects: [] }] };
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
