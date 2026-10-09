// Permanent rules the user added (argv prefixes). Always visible, always revocable.
import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { Rule } from './types.ts';

export interface StoredRule extends Rule {
  id: string;
  createdAt: number;
}

export class RuleStore {
  private readonly db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
  }

  list(): StoredRule[] {
    return (
      this.db
        .prepare('select * from rules order by created_at')
        .all() as unknown as {
        id: string;
        decision: 'allow' | 'deny';
        prefix: string;
        created_at: number;
      }[]
    ).map((r) => ({
      id: r.id,
      decision: r.decision,
      prefix: JSON.parse(r.prefix) as string[],
      createdAt: r.created_at,
    }));
  }

  add(rule: Rule): StoredRule {
    const same = this.list().find(
      (r) =>
        r.decision === rule.decision &&
        JSON.stringify(r.prefix) === JSON.stringify(rule.prefix),
    );
    if (same) return same;
    const id = randomUUID();
    const createdAt = Date.now();
    this.db
      .prepare(
        'insert into rules (id, decision, prefix, created_at) values (?, ?, ?, ?)',
      )
      .run(id, rule.decision, JSON.stringify(rule.prefix), createdAt);
    return { ...rule, id, createdAt };
  }

  remove(id: string): boolean {
    return (
      this.db.prepare('delete from rules where id = ?').run(id).changes > 0
    );
  }
}
