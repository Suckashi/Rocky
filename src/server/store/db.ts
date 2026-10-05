// Rocky's local database: node:sqlite (built into Node, nothing to compile).
import { DatabaseSync } from 'node:sqlite';

const MIGRATIONS: string[] = [
  `create table threads (
     id text primary key,
     agent_id text not null,
     name text,
     archived integer not null default 0,
     messages text not null default '[]',
     created_at integer not null,
     updated_at integer not null
   );
   create table runs (
     id text primary key,
     thread_id text not null references threads(id) on delete cascade,
     agent_id text not null,
     parent_run_id text,
     events text not null default '[]',
     outcome text not null check (outcome in ('succeeded', 'failed', 'unknown')),
     error text,
     created_at integer not null,
     finished_at integer
   );
   create index runs_by_thread on runs(thread_id, created_at);
   create table settings (key text primary key, value text not null);`,
  `create table receipts (
     id text primary key,
     thread_id text,
     run_id text,
     tool_call_id text,
     actor text not null,
     kind text not null,
     effect text not null,
     content_hash text not null,
     decision text not null check (decision in ('allowed', 'approved', 'rejected', 'denied')),
     reason text not null,
     outcome text not null check (outcome in ('pending', 'succeeded', 'failed', 'unknown', 'not-run')),
     detail text,
     created_at integer not null,
     finished_at integer
   );
   create index receipts_by_thread on receipts(thread_id, created_at);
   create table snapshots (
     receipt_id text not null references receipts(id) on delete cascade,
     path text not null,
     before_sha text,
     after_sha text,
     primary key (receipt_id, path)
   );
   create table rules (
     id text primary key,
     decision text not null check (decision in ('allow', 'deny')),
     prefix text not null,
     created_at integer not null
   );`,
];

export function openDatabase(path: string): DatabaseSync {
  const db = new DatabaseSync(path);
  db.exec(
    'pragma journal_mode = wal; pragma foreign_keys = on; pragma busy_timeout = 5000;',
  );
  const { user_version: version } = db.prepare('pragma user_version').get() as {
    user_version: number;
  };
  for (let i = version; i < MIGRATIONS.length; i++) {
    db.exec('begin');
    try {
      db.exec(MIGRATIONS[i]!);
      db.exec(`pragma user_version = ${i + 1}`);
      db.exec('commit');
    } catch (error) {
      db.exec('rollback');
      throw error;
    }
  }
  return db;
}
