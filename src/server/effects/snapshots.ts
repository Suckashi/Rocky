// Content-addressed snapshots of files before Rocky changes them, so any change can be
// restored without git. Blobs live in <data>/snapshots/ab/abcdef...
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';

export interface Snapshot {
  receiptId: string;
  path: string;
  /** null: the file did not exist before. */
  beforeSha: string | null;
  /** null: the file was deleted. */
  afterSha: string | null;
}

export class SnapshotStore {
  private readonly db: DatabaseSync;
  private readonly dir: string;

  constructor(db: DatabaseSync, dataDir: string) {
    this.db = db;
    this.dir = join(dataDir, 'snapshots');
  }

  put(content: Buffer): string {
    const sha = createHash('sha256').update(content).digest('hex');
    const folder = join(this.dir, sha.slice(0, 2));
    const file = join(folder, sha);
    if (!existsSync(file)) {
      mkdirSync(folder, { recursive: true });
      writeFileSync(file, content, { mode: 0o600 });
    }
    return sha;
  }

  read(sha: string): Buffer {
    return readFileSync(join(this.dir, sha.slice(0, 2), sha));
  }

  record(snapshot: Snapshot): void {
    this.db
      .prepare(
        'insert or replace into snapshots (receipt_id, path, before_sha, after_sha) values (?, ?, ?, ?)',
      )
      .run(
        snapshot.receiptId,
        snapshot.path,
        snapshot.beforeSha,
        snapshot.afterSha,
      );
  }

  forReceipts(ids: string[]): Snapshot[] {
    if (ids.length === 0) return [];
    const rows = this.db
      .prepare(
        `select * from snapshots where receipt_id in (${ids.map(() => '?').join(',')})`,
      )
      .all(...ids) as unknown as {
      receipt_id: string;
      path: string;
      before_sha: string | null;
      after_sha: string | null;
    }[];
    return rows.map((r) => ({
      receiptId: r.receipt_id,
      path: r.path,
      beforeSha: r.before_sha,
      afterSha: r.after_sha,
    }));
  }
}

/** A blob as write-effect content: UTF-8 text when it decodes cleanly, base64 otherwise. */
export function asContent(blob: Buffer): {
  content: string;
  encoding?: 'base64';
} {
  try {
    return {
      content: new TextDecoder('utf-8', {
        fatal: true,
        ignoreBOM: true,
      }).decode(blob),
    };
  } catch {
    return { content: blob.toString('base64'), encoding: 'base64' };
  }
}
