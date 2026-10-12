// A file is either its old content or its new content, never a cut-off mix: the new content
// goes to a temporary file next to it, reaches the disk, and then replaces the file.
import {
  closeSync,
  fsyncSync,
  openSync,
  renameSync,
  unlinkSync,
  writeSync,
} from 'node:fs';

/** The temporary file a write goes through (named, so it can be listed as private). */
export const tempOf = (file: string) => `${file}.tmp`;

const RETRY = new Set(['EPERM', 'EACCES', 'EBUSY']);

function pause(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** On Windows an antivirus or indexer can hold the target for a moment; try a few times. */
export function renameRetrying(from: string, to: string): void {
  for (let attempt = 0; ; attempt++) {
    try {
      renameSync(from, to);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code ?? '';
      if (process.platform !== 'win32' || !RETRY.has(code) || attempt >= 9)
        throw error;
      pause(20 * (attempt + 1));
    }
  }
}

export function writeFileAtomic(
  file: string,
  data: string | Buffer,
  mode = 0o600,
): void {
  const temp = tempOf(file);
  try {
    const fd = openSync(temp, 'w', mode);
    try {
      const bytes = typeof data === 'string' ? Buffer.from(data) : data;
      for (let done = 0; done < bytes.length;)
        done += writeSync(fd, bytes, done, bytes.length - done);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameRetrying(temp, file);
  } catch (error) {
    try {
      unlinkSync(temp);
    } catch {
      // Never created, or already renamed.
    }
    throw error;
  }
}
