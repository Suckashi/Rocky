import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path, { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { skillsPrompt } from '../../src/server/agent/skills.ts';
import {
  frontMatter,
  skillFile,
  SkillStore,
} from '../../src/server/skills/store.ts';

function install(): SkillStore {
  const skills = new SkillStore(mkdtempSync(join(tmpdir(), 'rocky-skills-')));
  const folder = join(skills.dir, 'changelog');
  mkdirSync(join(folder, 'templates'), { recursive: true });
  writeFileSync(
    join(folder, 'SKILL.md'),
    '---\nname: 更新紀錄\ndescription: 用繁體中文寫 CHANGELOG 條目\n---\n\n# 寫法\n\n每一條用「新增／修正」開頭。\n',
  );
  writeFileSync(join(folder, 'templates', 'entry.md'), '## 版本 x.y.z\n');
  writeFileSync(join(skills.dir, 'outside.txt'), 'secret');
  return skills;
}

describe('skills', () => {
  it('reads front matter', () => {
    expect(
      frontMatter('---\nname: a\ndescription: "b c"\n---\nbody').fields,
    ).toEqual({
      name: 'a',
      description: 'b c',
    });
    expect(frontMatter('no front matter').body).toBe('no front matter');
  });

  it('lists only names and descriptions in the prompt, loads the full text on demand', () => {
    const skills = install();
    expect(skillsPrompt(skills)).toContain(
      '- 更新紀錄: 用繁體中文寫 CHANGELOG 條目',
    );
    expect(skillsPrompt(skills)).not.toContain('新增／修正');
    const text = skills.read('更新紀錄');
    expect(text).toContain('每一條用「新增／修正」開頭。');
    expect(text).toContain('templates/entry.md');
    expect(skills.read('changelog', 'templates/entry.md')).toBe(
      '## 版本 x.y.z\n',
    );
  });

  it('never reads outside the skill folder', () => {
    const skills = install();
    expect(() => skills.read('更新紀錄', '../outside.txt')).toThrow('outside');
    expect(() => skills.read('更新紀錄', '/etc/hostname')).toThrow('outside');
    expect(() => skills.read('nope')).toThrow('no skill');
  });

  it('refuses links, other drives and UNC paths that leave the skill folder', () => {
    const skills = install();
    symlinkSync(
      join(skills.dir, 'outside.txt'),
      join(skills.dir, 'changelog', 'link.txt'),
    );
    expect(() => skills.read('更新紀錄', 'link.txt')).toThrow('outside');
    const root = 'C:\\Users\\me\\AppData\\Local\\Rocky\\skills\\changelog';
    expect(skillFile(root, 'templates\\entry.md', path.win32)).toBe(
      `${root}\\templates\\entry.md`,
    );
    for (const escape of [
      'D:\\secrets.txt',
      'D:secrets.txt',
      '\\\\server\\share\\file.txt',
      '..\\outside.txt',
      'C:\\Windows\\win.ini',
    ])
      expect(() => skillFile(root, escape, path.win32), escape).toThrow(
        'outside',
      );
  });
});
