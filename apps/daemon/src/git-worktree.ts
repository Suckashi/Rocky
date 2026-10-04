import { spawn } from "node:child_process";
import { terminateProcessTree } from "./terminate-process-tree.js";
import { lstat, realpath, access } from "node:fs/promises";
import {
  join,
  dirname,
  basename,
  delimiter,
  isAbsolute,
  relative,
  sep,
  normalize,
} from "node:path";
import { createHash } from "node:crypto";
import { RockyError } from "../../../packages/contracts/src/index.js";
import { resolveFileTarget, recheckFileTarget } from "./file-target.js";
const same = (a: string, b: string) =>
  process.platform === "win32"
    ? normalize(a).toLowerCase() === normalize(b).toLowerCase()
    : a === b;
const inside = (root: string, path: string) => {
  const rel = relative(root, path);
  return (
    rel === "" ||
    (!isAbsolute(rel) && rel !== ".." && !rel.startsWith(".." + sep))
  );
};

/** Local Git only. Caller must bind this prepared effect to daemon exact consent. */
export class GitWorktree {
  private async executable(root: string) {
    for (const directory of (process.env.PATH ?? "").split(delimiter)) {
      if (!isAbsolute(directory)) continue;
      try {
        const path = await realpath(
          join(directory, process.platform === "win32" ? "git.exe" : "git"),
        );
        if (inside(root, path) || !(await lstat(path)).isFile()) continue;
        await access(path);
        return path;
      } catch {
        /* Try the next installed executable, never the project cwd. */
      }
    }
    throw new RockyError(
      "git_unavailable",
      "Installed Git executable unavailable",
      422,
    );
  }
  private async run(
    executable: string,
    root: string,
    args: string[],
    signal?: AbortSignal,
  ) {
    signal?.throwIfAborted();
    const env: NodeJS.ProcessEnv = {};
    for (const name of ["PATH", "SystemRoot", "WINDIR", "TEMP", "TMP"])
      if (process.env[name]) env[name] = process.env[name];
    Object.assign(env, {
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null",
      GIT_ATTR_NOSYSTEM: "1",
      GIT_TERMINAL_PROMPT: "0",
      GIT_ALLOW_PROTOCOL: "",
      GIT_OPTIONAL_LOCKS: "0",
    });
    return new Promise<string>((resolve, reject) => {
      const child = spawn(
        executable,
        [
          "--no-pager",
          "-c",
          "core.hooksPath=" +
            (process.platform === "win32" ? "NUL" : "/dev/null"),
          "-c",
          "core.fsmonitor=false",
          "-c",
          "submodule.recurse=false",
          ...args,
        ],
        {
          cwd: root,
          env,
          shell: false,
          windowsHide: true,
          detached: process.platform !== "win32",
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      const chunks: Buffer[] = [];
      let bytes = 0,
        failed = false;
      let termination: Promise<void> | undefined;
      let terminationDeadline: ReturnType<typeof setTimeout> | undefined;
      const fail = () => {
        if (failed) return;
        failed = true;
        terminationDeadline = setTimeout(() => {
          reject(
            new RockyError(
              "git_failed",
              "Git termination could not be confirmed",
              409,
            ),
          );
        }, 6000);
        termination = terminateProcessTree(child).catch(() => {
          // Failed supervision never implies the effect did not occur.
          child.kill();
        });
      };
      const timer = setTimeout(fail, 30000),
        abort = () => fail();
      signal?.addEventListener("abort", abort, { once: true });
      const collect = (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > 262144) fail();
        else chunks.push(chunk);
      };
      child.stdout.on("data", collect);
      child.stderr.on("data", (chunk) => {
        bytes += chunk.length;
        if (bytes > 262144) fail();
      });
      child.once("error", () => {
        clearTimeout(timer);
        clearTimeout(terminationDeadline);
        signal?.removeEventListener("abort", abort);
        reject(
          new RockyError("git_unavailable", "Git process unavailable", 422),
        );
      });
      child.once("close", async (code) => {
        await termination;
        clearTimeout(timer);
        clearTimeout(terminationDeadline);
        signal?.removeEventListener("abort", abort);
        if (failed || code !== 0)
          reject(
            new RockyError(
              "git_failed",
              "Local Git command failed or was interrupted",
              409,
            ),
          );
        else resolve(Buffer.concat(chunks).toString("utf8"));
      });
    });
  }
  async prepare(
    root: string,
    destination: string,
    branch: string,
    signal?: AbortSignal,
  ) {
    signal?.throwIfAborted();
    if (
      !/^codex\/rocky-[a-f0-9-]{36}$/.test(branch) ||
      !isAbsolute(root) ||
      !isAbsolute(destination) ||
      !same(dirname(destination), dirname(root))
    )
      throw new RockyError(
        "worktree_scope",
        "Worktree must use an application-owned branch and a new sibling directory",
        403,
      );
    if (
      (!(await lstat(join(root, ".git"))).isDirectory() &&
        !(await lstat(join(root, ".git"))).isFile()) ||
      (await lstat(join(root, ".git"))).isSymbolicLink() ||
      !same(await realpath(root), root)
    )
      throw new RockyError(
        "git_scope",
        "A canonical Git workspace is required",
        422,
      );
    const rootStat = await lstat(root, { bigint: true }),
      gitStat = await lstat(join(root, ".git"), { bigint: true });
    const repoIdentity = createHash("sha256")
      .update(
        JSON.stringify([
          rootStat.dev.toString(),
          rootStat.ino.toString(),
          rootStat.birthtimeNs.toString(),
          gitStat.dev.toString(),
          gitStat.ino.toString(),
          gitStat.birthtimeNs.toString(),
        ]),
      )
      .digest("hex");
    const executable = await this.executable(root);
    const metadata = (
      await this.run(
        executable,
        root,
        ["rev-parse", "--absolute-git-dir"],
        signal,
      )
    ).trim();
    const common = (
      await this.run(
        executable,
        root,
        ["rev-parse", "--path-format=absolute", "--git-common-dir"],
        signal,
      )
    ).trim();
    for (const path of [metadata, common]) {
      if (
        !isAbsolute(path) ||
        !(await lstat(path)).isDirectory() ||
        (await lstat(path)).isSymbolicLink() ||
        !same(await realpath(path), path)
      )
        throw new RockyError(
          "git_scope",
          "Git metadata must be a canonical local directory",
          403,
        );
    }
    const top = (
      await this.run(executable, root, ["rev-parse", "--show-toplevel"], signal)
    ).trim();
    if (!same(await realpath(top), root))
      throw new RockyError(
        "git_scope",
        "Registered root must be the repository root",
        403,
      );
    const head = (
      await this.run(
        executable,
        root,
        ["rev-parse", "--verify", "HEAD"],
        signal,
      )
    ).trim();
    if (!/^[a-f0-9]{40,64}$/.test(head))
      throw new RockyError("git_head", "Committed Git HEAD is required", 422);
    const config = await this.run(
      executable,
      root,
      ["config", "--includes", "--null", "--list"],
      signal,
    );
    if (/(?:^|\0)filter\./.test(config))
      throw new RockyError(
        "git_filter_unavailable",
        "Repository filters require a separately verified adapter",
        422,
      );
    const target = await resolveFileTarget(
      dirname(destination),
      basename(destination),
    );
    if (target.exists)
      throw new RockyError(
        "worktree_exists",
        "Worktree destination must not exist",
        409,
      );
    return {
      root,
      destination,
      branch,
      executable,
      head,
      repoIdentity,
      metadataIdentity: createHash("sha256")
        .update(
          JSON.stringify(
            await Promise.all(
              [metadata, common].map(async (path) => {
                const stat = await lstat(path, { bigint: true });
                return [
                  path,
                  stat.dev.toString(),
                  stat.ino.toString(),
                  stat.birthtimeNs.toString(),
                ];
              }),
            ),
          ),
        )
        .digest("hex"),
      configHash: createHash("sha256").update(config).digest("hex"),
      target,
    };
  }
  async create(
    prepared: Awaited<ReturnType<GitWorktree["prepare"]>>,
    signal: AbortSignal,
  ) {
    signal.throwIfAborted();
    const fresh = await this.prepare(
      prepared.root,
      prepared.destination,
      prepared.branch,
      signal,
    );
    if (
      fresh.repoIdentity !== prepared.repoIdentity ||
      fresh.metadataIdentity !== prepared.metadataIdentity ||
      fresh.head !== prepared.head ||
      fresh.configHash !== prepared.configHash ||
      fresh.executable !== prepared.executable
    )
      throw new RockyError(
        "git_changed",
        "Git state changed; prepare fresh consent",
        409,
      );
    await recheckFileTarget(prepared.target);
    signal.throwIfAborted();
    // After dispatch, errors are unknown: Git may have created a branch or metadata.
    try {
      await this.run(
        prepared.executable,
        prepared.root,
        [
          "worktree",
          "add",
          "-b",
          prepared.branch,
          "--",
          prepared.destination,
          prepared.head,
        ],
        signal,
      );
      const head = (
        await this.run(
          prepared.executable,
          prepared.destination,
          ["rev-parse", "HEAD"],
          signal,
        )
      ).trim();
      const branch = (
        await this.run(prepared.executable, prepared.destination, [
          "symbolic-ref",
          "--short",
          "HEAD",
        ])
      ).trim();
      if (
        head !== prepared.head ||
        branch !== prepared.branch ||
        !same(await realpath(prepared.destination), prepared.destination)
      )
        throw Error();
      return {
        root: prepared.destination,
        branch,
        head,
        sourceRoot: prepared.root,
      };
    } catch {
      throw new RockyError(
        "worktree_unknown",
        "Worktree outcome requires inspection; no cleanup or replay performed",
        409,
      );
    }
  }
}
