// Rocky's own files are replaced whole or not at all; a damaged copy is noticed, not used.
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const failWrite = vi.hoisted(() => ({ on: false }));
vi.mock('node:fs', async (original) => {
  const fs = await original<typeof import('node:fs')>();
  return {
    ...fs,
    // A disk that fills up after the first few bytes.
    writeSync: (fd: number, buffer: Buffer, offset: number, length: number) => {
      if (!failWrite.on) return fs.writeSync(fd, buffer, offset, length);
      fs.writeSync(fd, buffer, offset, Math.min(length, 3));
      throw Object.assign(new Error('ENOSPC: no space left on device'), {
        code: 'ENOSPC',
      });
    },
  };
});

const { writeFileAtomic } =
  await import('../../src/server/effects/atomic-write.ts');
const { SnapshotDamaged, SnapshotStore } =
  await import('../../src/server/effects/snapshots.ts');
const { SettingsStore } = await import('../../src/server/store/settings.ts');
const { openDatabase } = await import('../../src/server/store/db.ts');
const { privateFiles } = await import('../../src/server/effects/paths.ts');
const { readPermission } =
  await import('../../src/server/external/opencode.ts');
const { testRocky } = await import('../fixtures/rocky.ts');

afterEach(() => {
  failWrite.on = false;
});

const tmp = () => mkdtempSync(join(tmpdir(), 'rocky-atomic-'));

describe('atomic writes', () => {
  it('keeps the old content when a write is cut off, and leaves no temporary file', () => {
    const dir = tmp();
    const file = join(dir, 'secrets.json');
    writeFileSync(file, '{"modelApiKey":"old"}');
    failWrite.on = true;
    expect(() => writeFileAtomic(file, '{"modelApiKey":"new"}')).toThrow(
      /ENOSPC/,
    );
    expect(readFileSync(file, 'utf8')).toBe('{"modelApiKey":"old"}');
    expect(readdirSync(dir)).toEqual(['secrets.json']);
  });

  it('a snapshot cut off on the way is not stored', () => {
    const dir = tmp();
    const snapshots = new SnapshotStore(openDatabase(':memory:'), dir);
    failWrite.on = true;
    expect(() => snapshots.put(Buffer.from('the whole file\n'))).toThrow();
    failWrite.on = false;
    // Neither a cut-off blob nor a temporary file is left in its folder.
    const [folder] = readdirSync(join(dir, 'snapshots'));
    expect(readdirSync(join(dir, 'snapshots', folder!))).toEqual([]);
    const sha = snapshots.put(Buffer.from('the whole file\n'));
    expect(snapshots.read(sha).toString()).toBe('the whole file\n');
  });
});

describe('snapshots', () => {
  it('a damaged blob is refused on read and repaired by the next save', () => {
    const dir = tmp();
    const snapshots = new SnapshotStore(openDatabase(':memory:'), dir);
    const content = Buffer.from('const answer = 41;\n');
    const sha = snapshots.put(content);
    const blob = join(dir, 'snapshots', sha.slice(0, 2), sha);
    writeFileSync(blob, 'const ans');
    expect(() => snapshots.read(sha)).toThrow(SnapshotDamaged);
    expect(snapshots.put(content)).toBe(sha);
    expect(snapshots.read(sha).equals(content)).toBe(true);
    // Damage that keeps the size (a flipped byte) is repaired too.
    writeFileSync(blob, 'const answer = 47;\n');
    expect(() => snapshots.read(sha)).toThrow(SnapshotDamaged);
    snapshots.put(content);
    expect(snapshots.read(sha).equals(content)).toBe(true);
  });
});

describe('secrets.json', () => {
  it('an unreadable file is kept aside and Rocky starts without the key', () => {
    const dir = tmp();
    writeFileSync(join(dir, 'secrets.json'), '{"modelApiKey":"sk-');
    const settings = new SettingsStore(openDatabase(':memory:'), dir);
    expect(settings.apiKey()).toBeUndefined();
    expect(readFileSync(join(dir, 'secrets.json.broken'), 'utf8')).toBe(
      '{"modelApiKey":"sk-',
    );
    expect(existsSync(join(dir, 'secrets.json'))).toBe(false);
    settings.setModel(
      { provider: 'openai-compatible', baseURL: 'http://x/v1', model: 'm' },
      'sk-new',
    );
    expect(settings.apiKey()).toBe('sk-new');
  });

  it('a byte-order mark from an editor is not a broken file', () => {
    const dir = tmp();
    writeFileSync(join(dir, 'secrets.json'), '\uFEFF{"modelApiKey":"sk-1"}');
    const settings = new SettingsStore(openDatabase(':memory:'), dir);
    expect(settings.apiKey()).toBe('sk-1');
    expect(existsSync(join(dir, 'secrets.json.broken'))).toBe(false);
  });

  it('the temporary and kept-aside copies are private like the file', () => {
    const dir = tmp();
    mkdirSync(join(dir, 'data'));
    const { rocky } = testRocky({ dataDir: join(dir, 'data'), port: 4397 });
    for (const name of [
      'secrets.json',
      'secrets.json.tmp',
      'secrets.json.broken',
      'api-token',
      'api-token.tmp',
    ])
      expect(rocky.gate.privateFiles).toContain(join(dir, 'data', name));
  });

  it('their names are secret wherever they appear, for Rocky and for OpenCode', () => {
    const dir = tmp();
    mkdirSync(join(dir, 'data'));
    const { rocky } = testRocky({ dataDir: join(dir, 'data'), port: 4397 });
    const mine = privateFiles(rocky.gate.privateFiles);
    const read = readPermission('linux');
    for (const name of [
      'secrets.json.tmp',
      'secrets.json.broken',
      'api-token.tmp',
    ]) {
      // A path a shell expands ($HOME/...): only its file name can be judged.
      expect(mine.named(`$HOME/x/${name}`)).toBe(true);
      expect(read[`*/${name}`]).toBe('ask');
    }
  });
});
