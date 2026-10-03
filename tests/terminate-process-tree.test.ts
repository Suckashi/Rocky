import { test, expect } from "vitest";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { terminateProcessTree } from "../apps/daemon/src/terminate-process-tree.js";

test("terminates an owned process and its live descendant, leaving another process alive", async () => {
  const options = {
    windowsHide: true,
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"] as ["ignore", "pipe", "pipe"],
  };
  const unrelated = spawn(
    process.execPath,
    ["-e", "setInterval(()=>{},1000)"],
    options,
  );
  const parent = spawn(
    process.execPath,
    [
      "-e",
      `
    const {spawn}=require('node:child_process');
    const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{windowsHide:true,stdio:'ignore'});
    child.once('spawn',()=>console.log(child.pid));
    setInterval(()=>{},1000);
  `,
    ],
    options,
  );
  try {
    const [data] = await once(parent.stdout!, "data");
    const descendant = Number(String(data).trim());
    expect(descendant).toBeGreaterThan(0);
    expect(() => process.kill(descendant, 0)).not.toThrow();
    const closed = once(parent, "close");
    await terminateProcessTree(parent);
    await closed;
    await expect
      .poll(() => {
        try {
          process.kill(descendant, 0);
          return true;
        } catch {
          return false;
        }
      })
      .toBe(false);
    expect(() => process.kill(unrelated.pid!, 0)).not.toThrow();
    await terminateProcessTree(parent); // Closed ownership is a no-op.
  } finally {
    await Promise.allSettled([
      terminateProcessTree(parent),
      terminateProcessTree(unrelated),
    ]);
  }
}, 15000);
