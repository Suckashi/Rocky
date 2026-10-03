import { DatabaseSync } from "node:sqlite";
import {
  openSync,
  writeFileSync,
  readFileSync,
  unlinkSync,
  closeSync,
} from "node:fs";
import { join } from "node:path";
import { RockyError } from "../../../packages/contracts/src/index.js";

export function acquireWriterLock(root: string) {
  // An OS-released SQLite lock serializes stale PID-file recovery as well as live writers.
  const lease = new DatabaseSync(join(root, "writer-lock.sqlite"));
  const path = join(root, "daemon.lock");
  let descriptor: number | undefined;
  try {
    lease.exec("PRAGMA busy_timeout=0; BEGIN EXCLUSIVE");
    try {
      descriptor = openSync(path, "wx");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const pid = Number(readFileSync(path, "utf8"));
      if (!Number.isSafeInteger(pid) || pid < 1)
        throw Error("Invalid lock owner");
      let dead = false;
      try {
        process.kill(pid, 0);
      } catch (error) {
        dead = (error as NodeJS.ErrnoException).code === "ESRCH";
      }
      if (!dead) throw Error("Live lock owner");
      unlinkSync(path);
      descriptor = openSync(path, "wx");
    }
    writeFileSync(descriptor, String(process.pid));
  } catch {
    try {
      if (descriptor !== undefined) {
        closeSync(descriptor);
        unlinkSync(path);
      }
    } finally {
      lease.close();
    }
    throw new RockyError(
      "store_locked",
      "Another daemon owns this data directory or its lock cannot be verified",
      409,
    );
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    try {
      closeSync(descriptor!);
      unlinkSync(path);
    } finally {
      lease.close();
    }
  };
}
