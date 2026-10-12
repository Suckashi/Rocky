// Content-addressed snapshots of files before Rocky changes them, so any change can be
// restored without git. Blobs live in <data>/snapshots/ab/abcdef...
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, statSync } from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { writeFileAtomic } from './atomic-write.ts';

/** A stored snapshot whose bytes are not the content it was saved as (a cut-off write,
 * a damaged disk): it is never written back over a file. */
export class SnapshotDamaged extends Error {
  constructor() {
    super('snapshot-damaged');
  }
}

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
    // A damaged blob (cut off before this was atomic, or changed on disk) is written again.
    if (!this.intact(file, sha, content.length)) {
      mkdirSync(folder, { recursive: true });
      writeFileAtomic(file, content);
    }
    return sha;
  }

  private intact(file: string, sha: string, size: number): boolean {
    try {
      return (
        statSync(file).size === size &&
        createHash('sha256').update(readFileSync(file)).digest('hex') === sha
      );
    } catch {
      return false;
    }
  }

  /** The snapshot's bytes, checked against its hash. */
  read(sha: string): Buffer {
    const blob = readFileSync(join(this.dir, sha.slice(0, 2), sha));
    if (createHash('sha256').update(blob).digest('hex') !== sha)
      throw new SnapshotDamaged();
    return blob;
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
