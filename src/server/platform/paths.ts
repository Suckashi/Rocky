// Where Rocky keeps its local data. Never inside a Git checkout.
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export function dataDir(env: NodeJS.ProcessEnv = process.env): string {
  const dir =
    env['ROCKY_DATA_DIR'] ??
    (process.platform === 'win32'
      ? join(
          env['LOCALAPPDATA'] ?? join(homedir(), 'AppData', 'Local'),
          'Rocky',
        )
      : join(
          env['XDG_DATA_HOME'] ?? join(homedir(), '.local', 'share'),
          'rocky',
        ));
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}
