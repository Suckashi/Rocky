import { test, expect, vi } from "vitest";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { WorkService } from "../apps/daemon/src/work-service.js";
import { NativeEnvironment } from "../apps/daemon/src/native-environment.js";

test("fixture engine lifecycle pins scope, image and resource policy; never pulls or removes", async () => {
  const base = await mkdtemp(join(tmpdir(), "rocky-engine-fixture-")),
    root = join(base, "workspace");
  await mkdir(root);
  const service = new WorkService(join(base, "data"));
  const id = randomUUID(),
    image = "fixture@sha256:" + "a".repeat(64),
    containerId = "b".repeat(64);
  let running = false,
    privileged = false;
  const args: string[][] = [];
  const execute = vi
    .spyOn(NativeEnvironment.prototype, "execute")
    .mockImplementation(async (command) => {
      args.push(command.args);
      const action = command.args.slice(4);
      let stdout = "";
      if (action[0] === "version") stdout = "fixture-not-a-real-engine";
      if (action[1] === "create") stdout = containerId;
      if (action[1] === "start") running = true;
      if (action[1] === "stop") running = false;
      if (action[1] === "inspect")
        stdout = JSON.stringify([
          {
            Id: containerId,
            Config: {
              Image: image,
              User: "65534:65534",
              Labels: { "rocky.environment": id },
            },
            HostConfig: {
              NetworkMode: "none",
              Privileged: privileged,
              ReadonlyRootfs: true,
              CapDrop: ["ALL"],
              SecurityOpt: ["no-new-privileges"],
              PidsLimit: 128,
              Memory: 512 * 1048576,
              NanoCpus: 1e9,
            },
            Mounts: [
              { Type: "bind", Source: root, Destination: "/work", RW: true },
            ],
            State: { Running: running },
          },
        ]);
      return {
        reason: "exited",
        launched: true,
        exitCode: 0,
        signal: null,
        stdout,
        stderr: "",
        outputTruncated: false,
      };
    });
  try {
    const workspace = await service.workspaces.save({
      id: randomUUID(),
      requestId: randomUUID(),
      expectedRevision: 0,
      name: "fixture",
      root,
    });
    const configured = await service.environments.create({
      requestId: id,
      config: {
        engineExecutable: process.execPath,
        image,
        endpoint:
          process.platform === "win32"
            ? "npipe:////./pipe/docker_engine"
            : "unix:///var/run/docker.sock",
        workspaceId: workspace.id,
        workspaceRevision: 1,
      },
    });
    expect(execute).not.toHaveBeenCalled();
    const command = {
      requestId: randomUUID(),
      expectedRevision: configured.revision,
      action: "start",
    };
    const started = await service.environments.command(
      id,
      command,
      new AbortController().signal,
    );
    expect(started.state).toBe("running");
    expect(started.compatibility).toBe("unverified");
    const count = args.length;
    expect(
      await service.environments.command(
        id,
        command,
        new AbortController().signal,
      ),
    ).toEqual(started);
    expect(args).toHaveLength(count);
    expect(args.find((entry) => entry.includes("create"))).toEqual(
      expect.arrayContaining([
        "--pull=never",
        "--network=none",
        "--read-only",
        "--cap-drop=ALL",
        image,
      ]),
    );
    privileged = true;
    const denied = await service.environments.command(
      id,
      {
        requestId: randomUUID(),
        expectedRevision: started.revision,
        action: "stop",
      },
      new AbortController().signal,
    );
    expect(denied.state).toBe("unknown");
    expect(args.some((entry) => entry.includes("stop"))).toBe(false);
    expect(
      args.some((entry) => entry.includes("pull") || entry.includes("rm")),
    ).toBe(false);
  } finally {
    execute.mockRestore();
    await service.close();
    await rm(base, { recursive: true, force: true });
  }
});
