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
  /** Code Rocky cannot follow (inline code, a script on its input, nesting too deep):
   * judged by the words in it. */
  opaque?: true;
  /** Runs in another folder than the command's (env -C, sudo -D). */
  elsewhere?: true;
}

export type Analysis =
  | { kind: 'parsed'; commands: SimpleCommand[] }
  | { kind: 'unparseable'; reason: string };

/** How many shell strings (sh -c, substitutions, eval) may nest; wrappers do not count. */
const MAX_DEPTH = 8;

/** Program name without directory or Windows executable extension, lower-cased. */
export function programName(token: string): string {
  const base = token.split(/[\\/]/).pop() ?? token;
  return base.replace(/\.(exe|cmd|bat|com|ps1)$/i, '').toLowerCase();
}

/** Stands in for a `$(...)` or backquoted command whose output the shell inserts. */
export const SUBSTITUTED = '$SUBSTITUTED';
/** Stands in for `<(...)`: a pipe the shell connects to that command, not a place. */
export const PROCESS_PIPE = '/dev/fd/63';

/** One command of a shell string, before its wrappers are unwrapped. */
export interface ShellCommand {
  argv: string[];
  redirects: string[];
  inputs: string[];
  expanding: string[];
  /** Text the program reads on its input: heredoc bodies and here-strings. */
  stdin: string[];
  /** Comes after a `|`: its input is the previous command's output. */
  piped: boolean;
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
]);

const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh', 'fish']);

const fresh = (piped = false): ShellCommand => ({
  argv: [],
  redirects: [],
  inputs: [],
  expanding: [],
  stdin: [],
  piped,
});

/** Index of the backquote closing one whose content starts at `from`, or the end. */
function closingBackquote(text: string, from: number): number {
  for (let j = from; j < text.length; j++) {
    if (text[j] === '\\') j++;
    else if (text[j] === '`') return j;
  }
  return text.length;
}

const ANSI_ESCAPES: Record<string, string> = {
  n: '\n',
  t: '\t',
  r: '\r',
  a: '\x07',
  b: '\b',
  e: '\x1b',
  E: '\x1b',
  f: '\f',
  v: '\v',
};

/** `{a,b}` in an unquoted word becomes one word per choice (at most 64). */
function braces(word: string): string[] {
  const words = [word];
  for (let i = 0; i < words.length && words.length < 64; i++) {
    const m = /\{([^{}]*,[^{}]*)\}/.exec(words[i]!);
    if (!m) continue;
    const choices = m[1]!
      .split(',')
      .map(
        (c) =>
          words[i]!.slice(0, m.index) +
          c +
          words[i]!.slice(m.index + m[0].length),
      );
    words.splice(i, 1, ...choices.slice(0, 64));
    i--;
  }
  return words.slice(0, 64);
}

interface Flavor {
  /** A backslash is an ordinary character (a Windows path separator), not an escape. */
  literalBackslash?: boolean;
  /** PowerShell: the backquote escapes, `{ }` hold statements, `<# #>` is a comment. */
  powershell?: boolean;
}

/**
 * Reads shell commands from `from`; inside a substitution (`untilParen`) it stops at the `)`
 * that closes it. Never fails: an unclosed quote or substitution runs to the end of the text,
 * so every command in it is still judged.
 */
function scan(
  text: string,
  from: number,
  flavor: Flavor,
  untilParen: boolean,
): ShellSplit & { end: number } {
  const ps = flavor.powershell === true;
  const literalBackslash = flavor.literalBackslash === true || ps;
  const commands: ShellCommand[] = [];
  const inner: string[] = [];
  let cur = fresh();
  let word = '';
  let inWord = false;
  /** How the word's first character was written, which decides whether the shell expands it. */
  let start: 'plain' | 'single' | 'double' | 'escaped' | null = null;
  let quotedWord = false;
  let bracy = false;
  let quote: '"' | "'" | null = null;
  let depth = 0;
  /** What the next word is: an argument, or what a redirect operator takes. */
  let next:
    | 'arg'
    | 'write'
    | 'read'
    | 'readwrite'
    | 'dup'
    | 'herestring'
    | 'heredoc'
    | 'heredoc-tabs' = 'arg';
  const heredocs: {
    delim: string;
    tabs: boolean;
    expands: boolean;
    command: ShellCommand;
  }[] = [];

  const add = (s: string, how: NonNullable<typeof start>) => {
    if (word === '' && start === null) start = how;
    if (how === 'plain' && /[{},]/.test(s)) bracy = true;
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
    const expandBraces = bracy && !ps;
    const target = next;
    word = '';
    inWord = false;
    start = null;
    quotedWord = false;
    bracy = false;
    next = 'arg';
    if (target === 'heredoc' || target === 'heredoc-tabs') {
      heredocs.push({
        delim: w,
        tabs: target === 'heredoc-tabs',
        expands: !quoted,
        command: cur,
      });
      return;
    }
    if (target === 'herestring') {
      cur.stdin.push(w);
      return;
    }
    if (target === 'dup' && /^(\d+|-)$/.test(w)) return;
    if (target === 'write' || target === 'dup' || target === 'readwrite')
      cur.redirects.push(w);
    if (target === 'read' || target === 'readwrite') cur.inputs.push(w);
    if (target === 'arg') {
      // { and } group commands; if/then/do run nothing.
      if (!quoted && (w === '{' || w === '}')) {
        endCommand();
        return;
      }
      if (cur.argv.length === 0 && !quoted && RESERVED.has(w)) return;
      cur.argv.push(...(expandBraces ? braces(w) : [w]));
    }
    if (expands) cur.expanding.push(w);
  };
  const endCommand = (piped = false) => {
    endWord();
    next = 'arg';
    if (cur.argv.length || cur.redirects.length || cur.inputs.length)
      commands.push(cur);
    cur = fresh(piped);
  };
  /** A substitution starting at `i` (its content at `i + 2`): returns where it ends. */
  const substitute = (i: number, how: 'plain' | 'double'): number => {
    const sub = scan(text, i + 2, flavor, true);
    inner.push(text.slice(i + 2, sub.end));
    add(SUBSTITUTED, how);
    return sub.end;
  };
  /** At a newline: skip the bodies of the heredocs opened on the line just ended. */
  const skipBodies = (newline: number): number => {
    let pos = newline + 1;
    for (const doc of heredocs.splice(0)) {
      const from = pos;
      let end = text.length;
      for (;;) {
        const nl = text.indexOf('\n', pos);
        const lineEnd = nl === -1 ? text.length : nl;
        const line = text.slice(pos, lineEnd).replace(/\r$/, '');
        const lineStart = pos;
        pos = lineEnd + 1;
        if (
          (doc.tabs ? line.replace(/^\t+/, '') : line) ===
          doc.delim.replace(/\r$/, '')
        ) {
          end = lineStart;
          break;
        }
        if (nl === -1) break;
      }
      const body = text.slice(from, Math.min(end, text.length));
      doc.command.stdin.push(body);
      // An unquoted delimiter lets the shell run the substitutions in the body.
      if (doc.expands) inner.push(...scanBody(body));
    }
    return pos - 2;
  };
  /** The substitutions in a heredoc body. */
  const scanBody = (body: string): string[] => {
    const found: string[] = [];
    for (let i = 0; i < body.length; i++) {
      const c = body[i]!;
      if (c === '\\') i++;
      else if (c === '$' && body[i + 1] === '(') {
        const sub = scan(body, i + 2, flavor, true);
        found.push(body.slice(i + 2, sub.end));
        i = sub.end;
      } else if (c === '`') {
        const end = closingBackquote(body, i + 1);
        if (end < body.length) found.push(body.slice(i + 1, end));
        i = end;
      }
    }
    return found;
  };

  let i = from;
  for (; i < text.length; i++) {
    const c = text[i]!;
    if (quote === "'") {
      if (c !== "'") add(c, 'single');
      else if (ps && text[i + 1] === "'") add(text[++i]!, 'single');
      else quote = null;
      continue;
    }
    if (quote === '"') {
      if (c === '"') quote = null;
      else if (ps && c === '`' && i + 1 < text.length)
        add(text[++i]!, 'escaped');
      else if (
        c === '\\' &&
        !literalBackslash &&
        i + 1 < text.length &&
        '$`"\\'.includes(text[i + 1]!)
      )
        add(text[++i]!, 'escaped');
      else if (c === '$' && text[i + 1] === '(') i = substitute(i, 'double');
      else if (!ps && c === '`') {
        const end = closingBackquote(text, i + 1);
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
    } else if (!ps && c === '$' && text[i + 1] === "'") {
      // $'...': a single-quoted word with backslash escapes.
      inWord = true;
      quotedWord = true;
      for (i += 2; i < text.length && text[i] !== "'"; i++) {
        const d = text[i]!;
        if (d !== '\\' || i + 1 >= text.length) {
          add(d, 'single');
          continue;
        }
        const e = text[++i]!;
        const hex = /^x([0-9a-fA-F]{1,2})/.exec(text.slice(i));
        const oct = /^([0-7]{1,3})/.exec(text.slice(i));
        if (hex) {
          add(String.fromCharCode(parseInt(hex[1]!, 16)), 'single');
          i += hex[0].length - 1;
        } else if (oct) {
          add(String.fromCharCode(parseInt(oct[1]!, 8)), 'single');
          i += oct[0].length - 1;
        } else add(ANSI_ESCAPES[e] ?? e, 'single');
      }
    } else if (ps && c === '`' && i + 1 < text.length) {
      add(text[++i]!, 'escaped');
      quotedWord = true;
    } else if (c === '\\' && !literalBackslash && i + 1 < text.length) {
      if (text[i + 1] === '\n') i++;
      else {
        add(text[++i]!, 'escaped');
        quotedWord = true;
      }
    } else if ((c === '$' || (ps && c === '@')) && text[i + 1] === '(') {
      i = substitute(i, 'plain');
    } else if (
      (c === '<' || c === '>') &&
      text[i + 1] === '(' &&
      !inWord &&
      !ps
    ) {
      // <(...) and >(...): a pipe to that command, given as a file name.
      const sub = scan(text, i + 2, flavor, true);
      inner.push(text.slice(i + 2, sub.end));
      add(PROCESS_PIPE, 'single');
      i = sub.end;
    } else if (!ps && c === '`') {
      const end = closingBackquote(text, i + 1);
      inner.push(text.slice(i + 1, end));
      add(SUBSTITUTED, 'plain');
      i = end;
    } else if (ps && c === '<' && text[i + 1] === '#') {
      const close = text.indexOf('#>', i + 2);
      i = close === -1 ? text.length : close + 1;
    } else if (c === '#' && !inWord) {
      const nl = text.indexOf('\n', i);
      i = (nl === -1 ? text.length : nl) - 1;
    } else if (c === '\n') {
      endCommand();
      if (heredocs.length > 0) i = skipBodies(i);
    } else if (/\s/.test(c)) {
      endWord();
    } else if (ps && (c === '{' || c === '}')) {
      endCommand();
    } else if (c === '(') {
      depth++;
      endCommand();
    } else if (c === ')') {
      if (untilParen && depth === 0) break;
      depth = Math.max(0, depth - 1);
      endCommand();
    } else if (c === ';') {
      endCommand();
    } else if (c === '|') {
      if (text[i + 1] === '|') {
        i++;
        endCommand();
      } else {
        if (text[i + 1] === '&') i++;
        endCommand(true);
      }
    } else if (c === '&') {
      if (text[i + 1] === '>' && !ps) {
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
        if (!ps && text.startsWith('<<<', i)) {
          i += 2;
          next = 'herestring';
        } else if (!ps && text[i + 1] === '<') {
          i++;
          if (text[i + 1] === '-') i++;
          next = text[i] === '-' ? 'heredoc-tabs' : 'heredoc';
        } else if (text[i + 1] === '&') {
          i++;
          next = 'dup';
        } else if (text[i + 1] === '>') {
          i++;
          next = 'readwrite';
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
  endCommand();
  return { commands, inner, end: i };
}

/**
 * Splits a POSIX shell string into commands: quotes (and $'...'), `;`, `&`, `|`, `&&`, `||`,
 * newlines, parentheses and braces, `#` comments, if/then/do words, `{a,b}`.
 * Redirects name files (`> f` writes, `< f` reads; `2>&1` names none); heredoc bodies and
 * here-strings are the program's input. `$(...)` and backquotes become SUBSTITUTED and
 * `<(...)` PROCESS_PIPE, with their commands in `inner`. Never fails: whatever is left open
 * runs to the end of the text.
 */
export function splitShell(text: string, flavor: Flavor = {}): ShellSplit {
  const { commands, inner } = scan(text, 0, flavor, false);
  return { commands, inner };
}

/** PowerShell statements: quotes, `;`, `|`, `&&`, `||`, `{ }` blocks, `$( )` and `@( )`,
 * `#` and `<# #>` comments. The backquote escapes; a backslash separates folders. */
export function splitPowerShell(text: string): ShellSplit {
  return splitShell(text, { powershell: true });
}

/** cmd.exe-style splitting: double quotes and ^ escapes; `&`, `&&`, `||`, `|` and
 * parentheses separate commands; `>`, `>>` write and `<` reads (`2>&1` names no file). A
 * switch stuck to the program (`rd/s/q`) is its own word, as cmd reads it. */
export function splitCmd(text: string): ShellSplit {
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
    else if (cur.argv.length === 0 && !quotedWord && /^[^/\\]+\/./.test(word)) {
      const [program, ...switches] = word.split('/');
      cur.argv.push(program!, ...switches.map((s) => `/${s}`));
    } else cur.argv.push(word);
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
    } else if (!quoted && (c === '&' || c === '|' || c === '(' || c === ')')) {
      endCommand();
      if ((c === '&' || c === '|') && text[i + 1] === c) i++;
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
  endCommand();
  return { commands, inner: [] };
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

/** Leading `NAME=value` (or `NAME+=value`) words set variables; they are not the program. */
function assignments(argv: string[]): { values: string[]; rest: string[] } {
  let i = 0;
  while (i < argv.length && /^[A-Za-z_]\w*\+?=/.test(argv[i]!)) i++;
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

/** Interpreters that run what they read on their input. */
const READS_CODE = new Set([
  ...Object.keys(INLINE_CODE),
  'php',
  'osascript',
  'pwsh',
  'powershell',
]);

/** A shell with no -c and no script reads its commands from its input. */
const readsCommands = (argv: string[]) => {
  const name = programName(argv[0] ?? '');
  if (!SHELLS.has(name)) return false;
  const operands = shellOperands(argv.slice(1));
  return !operands.command && (operands.stdin || operands.rest.length === 0);
};

/** The commands in a string a shell runs. A part Rocky cannot follow is kept as opaque and
 * judged by its words; the other parts are judged as usual. */
function nested(
  split: ShellSplit,
  shell: Shell,
  depth: number,
  positional: string[] = [],
): Analysis {
  const commands: SimpleCommand[] = [];
  const follow = (argv: string[]): SimpleCommand[] => {
    const result = unwrap(argv, depth + 1);
    return result.kind === 'parsed'
      ? result.commands
      : [{ argv, redirects: [], opaque: true }];
  };
  let previous: ShellCommand | undefined;
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
    // What a shell or an interpreter reads on its input is code: judge it too.
    const reader = found.find((c) => c.argv.length > 0);
    const input = [...part.stdin];
    if (
      part.piped &&
      previous &&
      ['echo', 'printf'].includes(programName(previous.argv[0] ?? ''))
    )
      input.push(previous.argv.slice(1).join(' '));
    if (reader && input.length > 0) {
      const name = programName(reader.argv[0] ?? '');
      for (const code of input) {
        if (readsCommands(reader.argv)) {
          const result = nested(splitShell(code), 'posix', depth + 1);
          if (result.kind === 'parsed') commands.push(...result.commands);
        } else if (READS_CODE.has(name))
          commands.push({ argv: [name, code], redirects: [], opaque: true });
      }
    }
    previous = part;
  }
  for (const text of split.inner)
    commands.push(
      ...follow(
        shell === 'powershell'
          ? ['pwsh', '-Command', text]
          : ['sh', '-c', text],
      ),
    );
  // A shell string's own arguments ($0, $1 ...) are literal words.
  if (positional.length > 0)
    commands.push({ argv: [], redirects: [], values: positional });
  return { kind: 'parsed', commands };
}

/** A shell's arguments: the -c string (the first operand after -c), whether it reads its
 * input (-s), and the rest. */
function shellOperands(args: string[]): {
  command: string | undefined;
  stdin: boolean;
  rest: string[];
} {
  let c = false;
  let stdin = false;
  let i = 0;
  for (; i < args.length; i++) {
    const t = args[i]!;
    if (!/^[-+]/.test(t)) break;
    if (/^-[a-zA-Z]*c[a-zA-Z]*$/.test(t)) c = true;
    if (/^-[a-zA-Z]*s[a-zA-Z]*$/.test(t)) stdin = true;
    if (/^[-+][oO]$|^--(rcfile|init-file)$/.test(t)) i++;
  }
  return c
    ? { command: args[i] ?? '', stdin, rest: args.slice(i + 1) }
    : { command: undefined, stdin, rest: args.slice(i) };
}

/** Programs that run the program after their options; `values` are options that take a
 * value, `operands` words before the program (a duration, a CPU mask), `chdir` options that
 * run it in another folder. */
const WRAPPERS: Record<
  string,
  { values?: RegExp; operands?: number; chdir?: RegExp }
> = {
  sudo: {
    values:
      /^-[ugpCDrtThU]$|^--(user|group|prompt|close-from|chdir|role|type|host|other-user|command-timeout)$/,
    chdir: /^(-D|--chdir)/,
  },
  doas: { values: /^-[uC]$/ },
  nohup: {},
  time: { values: /^-[fo]$|^--(format|output)$/ },
  nice: { values: /^-n$|^--adjustment$/ },
  ionice: { values: /^-[cnpPut]$|^--(class|classdata|pid|pgid|uid)$/ },
  command: {},
  builtin: {},
  exec: { values: /^-a$/ },
  env: {
    values: /^-[uCS]$|^--(unset|chdir|split-string)$/,
    chdir: /^(-C|--chdir)/,
  },
  timeout: { values: /^-[sk]$|^--(signal|kill-after)$/, operands: 1 },
  setsid: {},
  stdbuf: { values: /^-[ioe]$/ },
  chrt: { operands: 1 },
  taskset: { operands: 1 },
  flock: { values: /^-[wEn]$/, operands: 1 },
  unbuffer: {},
  caffeinate: {},
  coproc: {},
  xargs: {
    values:
      /^-[nILPsdEa]$|^--(max-args|max-lines|max-procs|max-chars|delimiter|eof|arg-file|replace)$/,
  },
  call: {},
};

function unwrapProgram(argv: string[], depth: number): Analysis {
  if (argv.length === 0) return { kind: 'parsed', commands: [] };
  const name = programName(argv[0]!);
  const rest = argv.slice(1);
  const wrapper = WRAPPERS[name];
  if (wrapper) {
    let operands = wrapper.operands ?? 0;
    let elsewhere = false;
    let i = 0;
    for (; i < rest.length; i++) {
      const t = rest[i]!;
      if (t === '--') {
        i++;
        break;
      }
      if (t.startsWith('-') && t.length > 1) {
        if (wrapper.chdir?.test(t)) elsewhere = true;
        if (wrapper.values?.test(t)) i++;
        continue;
      }
      if (operands > 0) {
        operands--;
        continue;
      }
      break;
    }
    // Wrappers shrink the argv, so they do not count towards the depth.
    const result = unwrap(rest.slice(i), depth);
    if (!elsewhere || result.kind === 'unparseable') return result;
    return {
      kind: 'parsed',
      commands: result.commands.map((c) => ({
        ...c,
        elsewhere: true as const,
      })),
    };
  }
  // eval and watch run their words as a shell string.
  if (name === 'eval')
    return nested(splitShell(rest.join(' ')), 'posix', depth);
  if (name === 'watch') {
    const i = rest.findIndex(
      (t, k) => !t.startsWith('-') && !/^-[nqg]$/.test(rest[k - 1] ?? ''),
    );
    return i === -1
      ? { kind: 'parsed', commands: [] }
      : nested(splitShell(rest.slice(i).join(' ')), 'posix', depth);
  }
  if (name === 'start') {
    // cmd's start: options, then an optional quoted title, then the program.
    let i = 0;
    while (i < rest.length && rest[i]!.startsWith('/'))
      i += /^\/(d|node|affinity)$/i.test(rest[i]!) ? 2 : 1;
    if (rest[i] === '' || /\s/.test(rest[i] ?? '')) i++;
    return unwrap(rest.slice(i), depth);
  }
  if (SHELLS.has(name)) {
    const { command, rest: operands, stdin } = shellOperands(rest);
    if (command === undefined)
      return stdin || operands.length === 0
        ? { kind: 'parsed', commands: [{ argv, redirects: [] }] }
        : { kind: 'unparseable', reason: 'shell-script' };
    // Words after the string are its $0, $1 ...
    return nested(splitShell(command), 'posix', depth, operands);
  }
  if (name === 'cmd') {
    const c = rest.findIndex((t) => /^\/[ck]$/i.test(t));
    if (c === -1)
      return { kind: 'parsed', commands: [{ argv, redirects: [] }] };
    let text = rest.slice(c + 1).join(' ');
    // cmd /c "..." with the whole command quoted: cmd drops the outer quotes.
    if (/^".*"$/s.test(text.trim())) text = text.trim().slice(1, -1);
    return nested(splitCmd(text), 'cmd', depth);
  }
  if (name === 'powershell' || name === 'pwsh') {
    const enc = rest.findIndex((t) => /^-(e|ec|encodedcommand)$/i.test(t));
    if (enc !== -1) {
      const decoded = decodePowerShellBase64(rest[enc + 1] ?? '');
      return decoded === undefined
        ? { kind: 'unparseable', reason: 'powershell-encoded' }
        : nested(splitPowerShell(decoded), 'powershell', depth);
    }
    const c = rest.findIndex((t) => /^-(c|command)$/i.test(t));
    if (c !== -1)
      return nested(
        splitPowerShell(rest.slice(c + 1).join(' ')),
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
/** A PowerShell switch by any prefix of its name (-r, -Rec, -Recurse:$true). */
const psFlag = (argv: string[], name: string) =>
  argv.some((t) => {
    const flag = t.replace(/:.*$/, '');
    return (
      flag.startsWith('-') &&
      flag.length > 1 &&
      name.toLowerCase().startsWith(flag.slice(1).toLowerCase())
    );
  });

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

/** A word without the variables and substitutions inside it, which may be empty
 * (`r$()m`, `.env$Z`). */
export const withoutExpansions = (word: string) =>
  word.replace(/\$\{[^}]*\}|\$SUBSTITUTED|\$(?:env:)?\w+/g, '');

/** Every danger among the commands, in order. A command from a shell string is also judged
 * with its variables and substitutions left out. */
export function findDangers(commands: SimpleCommand[]): string[] {
  const found: string[] = [];
  for (let i = 0; i < commands.length; i++) {
    const command = commands[i]!;
    const reason =
      dangerReason(command, commands[i + 1]) ??
      (command.shell
        ? dangerReason(
            { ...command, argv: command.argv.map(withoutExpansions) },
            commands[i + 1],
          )
        : undefined);
    if (reason && !found.includes(reason)) found.push(reason);
  }
  return found;
}

/** The first dangerous program among the commands, if any. */
export function findDanger(commands: SimpleCommand[]): string | undefined {
  return findDangers(commands)[0];
}
