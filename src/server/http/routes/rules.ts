// Permanent rules (approvals.md): argv prefixes the user adds in Settings, always visible
// and removable. They only cover commands, and an allow rule never overrides the two
// bottom lines (dangerous commands, outside actions): the policy checks those first.
import { Hono } from 'hono';
import { z } from 'zod';
import { splitPosix } from '../../effects/commands.ts';
import type { ReceiptStore } from '../../effects/receipts.ts';
import type { RuleStore } from '../../effects/rules.ts';
import {
  prefixKey,
  SUGGESTION_SINCE,
  suggestRules,
} from '../../effects/suggestions.ts';
import type { SettingsStore } from '../../store/settings.ts';

export type PatternError =
  'empty' | 'not-one-command' | 'star-not-last' | 'too-broad';

/** "npm test *" → ["npm", "test", "*"]; quotes group words, as in a shell. */
export function parsePattern(
  pattern: string,
  decision: 'allow' | 'deny',
): { prefix: string[] } | { error: PatternError } {
  const commands = splitPosix(pattern.trim());
  if (!commands || commands.length === 0 || commands[0]!.length === 0)
    return { error: 'empty' };
  if (commands.length !== 1) return { error: 'not-one-command' };
  const prefix = commands[0]!;
  if (prefix.slice(0, -1).includes('*')) return { error: 'star-not-last' };
  if (decision === 'allow' && prefix[0] === '*') return { error: 'too-broad' };
  return { prefix };
}

const prefixBody = z
  .object({ prefix: z.array(z.string().max(1000)).min(2).max(10) })
  .strict();

export function ruleRoutes(
  rules: RuleStore,
  receipts: ReceiptStore,
  settings: SettingsStore,
): Hono {
  const app = new Hono();
  const suggestions = () =>
    suggestRules(
      receipts.approvedCommands(SUGGESTION_SINCE()),
      rules.list(),
      settings.dismissedSuggestions(),
    );

  app.get('/rules/suggestions', (c) => c.json({ suggestions: suggestions() }));

  // Accepting adds exactly the suggested allow rule, and only while it is still suggested.
  app.post('/rules/suggestions/accept', async (c) => {
    const parsed = prefixBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'invalid-rule' }, 400);
    const key = prefixKey(parsed.data.prefix);
    if (!suggestions().some((s) => prefixKey(s.prefix) === key))
      return c.json({ error: 'not-suggested' }, 409);
    return c.json({
      rule: rules.add({ decision: 'allow', prefix: parsed.data.prefix }),
    });
  });

  app.post('/rules/suggestions/dismiss', async (c) => {
    const parsed = prefixBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'invalid-rule' }, 400);
    settings.dismissSuggestion(prefixKey(parsed.data.prefix));
    return c.json({ ok: true });
  });

  app.get('/rules', (c) => c.json({ rules: rules.list() }));
  app.post('/rules', async (c) => {
    const parsed = z
      .object({
        decision: z.enum(['allow', 'deny']),
        pattern: z.string().max(1000),
      })
      .strict()
      .safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'invalid-rule' }, 400);
    const result = parsePattern(parsed.data.pattern, parsed.data.decision);
    if ('error' in result) return c.json({ error: result.error }, 400);
    const duplicate = rules
      .list()
      .some(
        (r) =>
          r.decision === parsed.data.decision &&
          JSON.stringify(r.prefix) === JSON.stringify(result.prefix),
      );
    if (duplicate) return c.json({ error: 'duplicate' }, 409);
    return c.json({
      rule: rules.add({
        decision: parsed.data.decision,
        prefix: result.prefix,
      }),
    });
  });
  app.delete('/rules/:id', (c) =>
    rules.remove(c.req.param('id'))
      ? c.json({ ok: true })
      : c.json({ error: 'not-found' }, 404),
  );
  return app;
}
