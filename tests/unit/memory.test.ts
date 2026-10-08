import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MemoryStore, terms } from '../../src/server/memory/store.ts';

describe('memory search', () => {
  it('splits Chinese into two-character terms and English into words', () => {
    expect(terms('繁體中文 reply')).toEqual(['繁體', '體中', '中文', 'reply']);
  });

  it('ranks memories by matching terms, titles first', () => {
    const memory = new MemoryStore(mkdtempSync(join(tmpdir(), 'rocky-mem-')));
    writeFileSync(
      join(memory.dir, 'a.md'),
      '# 專案慣例\n\n測試用 node --test。\n',
    );
    writeFileSync(join(memory.dir, 'b.md'), '# 回覆偏好\n\n用繁體中文回覆。\n');
    expect(memory.search('中文回覆').map((m) => m.title)).toEqual(['回覆偏好']);
    expect(memory.search('測試').map((m) => m.title)).toEqual(['專案慣例']);
    expect(memory.search('天氣')).toEqual([]);
  });

  it('reuses the file of a memory with the same title and makes safe file names', () => {
    const memory = new MemoryStore(mkdtempSync(join(tmpdir(), 'rocky-mem-')));
    writeFileSync(join(memory.dir, 'x.md'), '# 回覆偏好\n\n舊的\n');
    expect(memory.pathFor('回覆偏好')).toBe(join(memory.dir, 'x.md'));
    expect(memory.pathFor('a/b: c?')).toBe(join(memory.dir, 'a-b-c.md'));
  });
});
