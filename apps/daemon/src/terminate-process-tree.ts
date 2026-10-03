import { spawn, type ChildProcess } from "node:child_process";
import { join, isAbsolute } from "node:path";

/** Only accepts a process owned by the caller; POSIX callers must spawn detached. */
export async function terminateProcessTree(child: ChildProcess): Promise<void> {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null)
    return;
  if (process.platform !== "win32") {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
    }
    return;
  }
  const systemRoot = process.env.SystemRoot;
  if (!systemRoot || !isAbsolute(systemRoot))
    throw new Error("System process termination unavailable");
  await new Promise<void>((resolve, reject) => {
    const terminator = spawn(
      join(systemRoot, "System32", "taskkill.exe"),
      ["/PID", String(child.pid), "/T", "/F"],
      { shell: false, windowsHide: true, stdio: "ignore" },
    );
    const timer = setTimeout(() => {
      terminator.kill();
      reject(new Error("Process tree termination timed out"));
    }, 5000);
    terminator.once("error", () => {
      clearTimeout(timer);
      reject(new Error("Process tree termination unavailable"));
    });
    terminator.once("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error("Process tree termination not confirmed"));
    });
  });
}
