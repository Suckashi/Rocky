// Skills: folders the user installs by hand in <data>/skills/<name>/ with a SKILL.md
// (front matter: name, description). Only the list is in the prompt; the full text is
// loaded when needed. A skill is text: it grants no permissions.
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
} from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

export interface Skill {
  name: string;
  description: string;
  folder: string;
}

const FILE_LIMIT = 100_000;

/** Front matter between "---" lines: simple "key: value" pairs. */
export function frontMatter(text: string): {
  fields: Record<string, string>;
  body: string;
} {
  const match = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (!match) return { fields: {}, body: text };
  const fields: Record<string, string> = {};
  for (const line of match[1]!.split(/\r?\n/)) {
    const kv = /^([\w-]+):\s*(.*)$/.exec(line);
    if (kv) fields[kv[1]!] = kv[2]!.replace(/^["']|["']$/g, '').trim();
  }
  return { fields, body: text.slice(match[0].length) };
}

export class SkillStore {
  readonly dir: string;

  constructor(dataDir: string) {
    this.dir = join(dataDir, 'skills');
    mkdirSync(this.dir, { recursive: true });
  }

  list(): Skill[] {
    const skills: Skill[] = [];
    for (const folder of readdirSync(this.dir)) {
      const file = join(this.dir, folder, 'SKILL.md');
      if (!existsSync(file)) continue;
      const { fields } = frontMatter(readFileSync(file, 'utf8'));
      skills.push({
        name: fields['name'] || folder,
        description: fields['description'] ?? '',
        folder,
      });
    }
    return skills.sort((a, b) => a.name.localeCompare(b.name));
  }

  /** SKILL.md (or another text file in the skill's folder), never anything outside it. */
  read(name: string, file = 'SKILL.md'): string {
    const skill = this.list().find((s) => s.name === name || s.folder === name);
    if (!skill) throw new Error(`no skill named "${name}"`);
    const root = join(this.dir, skill.folder);
    const path = resolve(root, file);
    if (
      relative(root, path).startsWith('..') ||
      relative(root, path).includes(`..${sep}`)
    )
      throw new Error('path outside the skill folder');
    if (!existsSync(path) || !statSync(path).isFile())
      throw new Error(`no file ${file} in skill ${name}`);
    const text = readFileSync(path, 'utf8');
    const files = readdirSync(root, {
      recursive: true,
      encoding: 'utf8',
    }).filter((f) => f !== 'SKILL.md' && statSync(join(root, f)).isFile());
    const body =
      text.length > FILE_LIMIT
        ? `${text.slice(0, FILE_LIMIT)}\n[truncated]`
        : text;
    return file === 'SKILL.md' && files.length
      ? `${body}\n\n(Other files in this skill, readable with load_skill and "file": ${files.join(', ')})`
      : body;
  }
}
