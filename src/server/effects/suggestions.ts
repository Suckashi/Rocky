// Roko's rule suggestions (approvals.md): when the user keeps approving the same kind of
// command, suggest a permanent allow rule for it. Suggestions are only offered; a rule
// exists only after the user accepts it. Dangerous commands, commands that reach outside
// the project, and too-broad prefixes are never suggested.
import { analyzeCommand, findDanger } from './commands.ts';
import { matchesPrefix } from './policy.ts';
import type { Receipt } from './receipts.ts';
import type { Rule } from './types.ts';

export interface RuleSuggestion {
  prefix: string[];
  /** How many times the user approved a command it covers. */
  count: number;
  example: string[];
}

const THRESHOLD = 2;
const WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
export const SUGGESTION_SINCE = () => Date.now() - WINDOW_MS;

/** Program and subcommand words (no paths, flags or values), at most 3, then "*". */
export function suggestedPrefix(argv: string[]): string[] | undefined {
  const words: string[] = [];
  for (const arg of argv) {
    if (words.length === 3) break;
    // The program may be a full path (rules compare its name); later words must be plain.
    const plain =
      words.length === 0 || /^[\p{L}\p{N}][\p{L}\p{N}_:-]*$/u.test(arg);
    if (!plain) break;
    words.push(arg);
  }
  // "node *" or "python *" would allow any script: too broad to suggest.
  return words.length >= 2 ? [...words, '*'] : undefined;
}

export const prefixKey = (prefix: string[]) => JSON.stringify(prefix);

export function suggestRules(
  approved: Receipt[],
  rules: Rule[],
  dismissed: ReadonlySet<string>,
  windows = process.platform === 'win32',
): RuleSuggestion[] {
  const found = new Map<string, RuleSuggestion>();
  for (const receipt of approved) {
    const effect = receipt.effect;
    // Only commands asked because of the mode: not dangerous, not outside, not unparseable.
    if (effect.kind !== 'command' || receipt.reason !== 'mode') continue;
    const analysis = analyzeCommand(effect.argv);
    if (analysis.kind !== 'parsed' || analysis.commands.length !== 1) continue;
    if (findDanger(analysis.commands)) continue;
    if (analysis.commands[0]!.redirects.length) continue;
    const prefix = suggestedPrefix(effect.argv);
    if (!prefix) continue;
    const key = prefixKey(prefix);
    if (dismissed.has(key)) continue;
    if (rules.some((r) => matchesPrefix(effect.argv, r.prefix, windows)))
      continue;
    const entry = found.get(key) ?? { prefix, count: 0, example: effect.argv };
    entry.count++;
    found.set(key, entry);
  }
  return [...found.values()]
    .filter((s) => s.count >= THRESHOLD)
    .sort((a, b) => b.count - a.count);
}
