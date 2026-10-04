import { test, expect, vi } from "vitest";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { NativeEnvironment } from "../apps/daemon/src/native-environment.js";

test("native adapter runs exact argv in the selected cwd without ambient credentials or shell expansion", async () => {
  const root = await mkdtemp(join(tmpdir(), "rocky-native-"));
  vi.stubEnv("ROCKY_NATIVE_SECRET_FIXTURE", "must-not-inherit");
  try {
    const result = await new NativeEnvironment().execute(
      {
        executable: process.execPath,
        cwd: root,
        timeoutMs: 5000,
        maxOutputBytes: 4096,
        args: [
          "-e",
          "require('node:fs').writeFileSync('result.txt',process.argv[1]);console.log(JSON.stringify({secret:process.env.ROCKY_NATIVE_SECRET_FIXTURE??null,cwd:process.cwd()}));console.error('stderr evidence');process.exitCode=7",
          "literal & | $(command)",
        ],
      },
      new AbortController().signal,
    );
    expect(result).toMatchObject({
      reason: "exited",
      launched: true,
      exitCode: 7,
      outputTruncated: false,
    });
    expect(await readFile(join(root, "result.txt"), "utf8")).toBe(
      "literal & | $(command)",
    );
    expect(JSON.parse(result.stdout).secret).toBeNull();
    expect(result.stderr).toContain("stderr evidence");
  } finally {
    vi.unstubAllEnvs();
    await rm(root, { recursive: true, force: true });
  }
});

test.each(["cancelled", "timed_out", "output_limit"] as const)(
  "native bounded execution: %s",
  async (reason) => {
    const root = await mkdtemp(join(tmpdir(), "rocky-native-"));
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      if (reason === "cancelled")
        timer = setTimeout(() => controller.abort(), 500);
      const result = await new NativeEnvironment().execute(
        {
          executable: process.execPath,
          cwd: root,
          timeoutMs: reason === "timed_out" ? 500 : 5000,
          maxOutputBytes: 1024,
          args: [
            "-e",
            reason === "output_limit"
              ? "setInterval(()=>process.stdout.write('x'.repeat(4096)),10)"
              : "setInterval(()=>{},1000)",
          ],
        },
        controller.signal,
      );
      expect(result.reason).toBe(reason);
      expect(result.launched).toBe(true);
      expect(
        Buffer.byteLength(result.stdout) + Buffer.byteLength(result.stderr),
      ).toBeLessThanOrEqual(1024);
      expect(result.outputTruncated).toBe(reason === "output_limit");
    } finally {
      clearTimeout(timer);
      await rm(root, { recursive: true, force: true });
    }
  },
);

test("native validation and pre-abort do not launch a process", async () => {
  const root = await mkdtemp(join(tmpdir(), "rocky-native-"));
  try {
    const adapter = new NativeEnvironment();
    const input = {
      executable: process.execPath,
      cwd: root,
      args: ["-e", "require('node:fs').writeFileSync('unwanted','bad')"],
      timeoutMs: 5000,
      maxOutputBytes: 1024,
    };
    await expect(adapter.execute(input, AbortSignal.abort())).rejects.toThrow();
    await expect(
      adapter.execute(
        { ...input, executable: "node" },
        new AbortController().signal,
      ),
    ).rejects.toThrow();
    await expect(readFile(join(root, "unwanted"))).rejects.toThrow();
    expect(adapter.capabilities).toEqual({
      mode: "native",
      isolation: "none",
      networkEnforcement: "application_only",
    });
    const invalid = join(root, "not-executable");
    await writeFile(invalid, "not an executable");
    const result = await adapter.execute(
      { ...input, executable: invalid },
      new AbortController().signal,
    );
    expect(result).toMatchObject({
      reason: "spawn_failed",
      launched: false,
      exitCode: null,
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("native cancellation terminates an owned descendant process", async () => {
  const root = await mkdtemp(join(tmpdir(), "rocky-native-tree-"));
  const controller = new AbortController();
  const running = new NativeEnvironment().execute(
    {
      executable: process.execPath,
      cwd: root,
      timeoutMs: 5000,
      maxOutputBytes: 1024,
      args: [
        "-e",
        "const c=require('node:child_process').spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});c.once('spawn',()=>require('node:fs').writeFileSync('child.pid',String(c.pid)));setInterval(()=>{},1000)",
      ],
    },
    controller.signal,
  );
  try {
    let pid = 0;
    await vi.waitFor(
      async () => {
        pid = Number(await readFile(join(root, "child.pid"), "utf8"));
        expect(pid).toBeGreaterThan(0);
        expect(() => process.kill(pid, 0)).not.toThrow();
      },
      { timeout: 3000 },
    );
    controller.abort();
    expect((await running).reason).toBe("cancelled");
    await vi.waitFor(() => expect(() => process.kill(pid, 0)).toThrow(), {
      timeout: 2000,
    });
  } finally {
    controller.abort();
    await running;
    await rm(root, { recursive: true, force: true });
  }
});
