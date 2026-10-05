// Memory: Markdown files in Rocky's data folder, one memory per file ("# Title" first).
// Writes go through the gate like any file write (receipts, snapshots, undo); this module
// only lists, reads and searches.
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
} from 'node:fs';
import { join } from 'node:path';

export interface Memory {
  file: string;
  title: string;
  content: string;
  updatedAt: number;
}

const titleOf = (text: string, file: string) =>
  /^#\s+(.+)$/m.exec(text)?.[1]?.trim() ?? file.replace(/\.md$/, '');

/** Search terms: CJK text as overlapping two-character pieces, other text as lowercase words. */
export function terms(text: string): string[] {
  const out: string[] = [];
  for (const chunk of text
    .toLowerCase()
    .match(/[\p{Script=Han}]+|[\p{L}\p{N}_]+/gu) ?? []) {
    if (/\p{Script=Han}/u.test(chunk)) {
      if (chunk.length === 1) out.push(chunk);
      for (let i = 0; i + 1 < chunk.length; i++)
        out.push(chunk.slice(i, i + 2));
    } else if (chunk.length > 1) out.push(chunk);
  }
  return out;
}

export class MemoryStore {
  readonly dir: string;

  constructor(dataDir: string) {
    this.dir = join(dataDir, 'memory');
    mkdirSync(this.dir, { recursive: true });
  }

  list(): Memory[] {
    return readdirSync(this.dir)
      .filter((f) => f.endsWith('.md'))
      .map((file) => {
        const path = join(this.dir, file);
        const content = readFileSync(path, 'utf8');
        return {
          file,
          title: titleOf(content, file),
          content,
          updatedAt: statSync(path).mtimeMs,
        };
      })
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  get(file: string): Memory | undefined {
    return this.list().find((m) => m.file === file);
  }

  /** The file for a title: the existing memory with that title, or a new file name. */
  pathFor(title: string): string {
    const existing = this.list().find((m) => m.title === title.trim());
    if (existing) return join(this.dir, existing.file);
    const slug =
      title
        .trim()
        .replace(/[\\/:*?"<>|#\s.]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 60) || 'memory';
    let name = `${slug}.md`;
    for (let n = 2; existsSync(join(this.dir, name)); n++)
      name = `${slug}-${n}.md`;
    return join(this.dir, name);
  }

  /** Memories ranked by how many query terms they contain (titles count double). */
  search(query: string, limit = 5): (Memory & { score: number })[] {
    const wanted = [...new Set(terms(query))];
    if (wanted.length === 0) return [];
    return this.list()
      .map((m) => {
        const body = m.content.toLowerCase();
        const title = m.title.toLowerCase();
        const score = wanted.reduce(
          (sum, t) =>
            sum + (body.includes(t) ? 1 : 0) + (title.includes(t) ? 1 : 0),
          0,
        );
        return { ...m, score };
      })
      .filter((m) => m.score > 0)
      .sort((a, b) => b.score - a.score || b.updatedAt - a.updatedAt)
      .slice(0, limit);
  }
}

export function memoryMarkdown(title: string, content: string): string {
  return `# ${title.trim()}\n\n${content.trim()}\n`;
}
