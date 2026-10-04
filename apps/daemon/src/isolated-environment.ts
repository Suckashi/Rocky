import { randomUUID } from "node:crypto";
import { mkdir, lstat, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";
import { z } from "zod";
import {
  environmentCommandSchema,
  environmentCreateSchema,
  environmentSchema,
  computerCommandSchema,
  type ComputerEnvironment,
} from "../../../packages/contracts/src/environments.js";
import {
  RockyError,
  type Work,
} from "../../../packages/contracts/src/index.js";
import { Store } from "./store.js";
import { WorkspaceRegistry } from "./workspaces.js";
import { NativeEnvironment } from "./native-environment.js";
import { intentHash } from "./intent.js";

const inspectionSchema = z
  .array(
    z.object({
      Id: z.string().regex(/^[a-f0-9]{64}$/),
      Config: z.object({
        Image: z.string(),
        User: z.string(),
        Labels: z.record(z.string(), z.string()),
      }),
      HostConfig: z.object({
        NetworkMode: z.string(),
        Privileged: z.boolean(),
        ReadonlyRootfs: z.boolean(),
        CapDrop: z.array(z.string()),
        SecurityOpt: z.array(z.string()),
        PidsLimit: z.number(),
        Memory: z.number(),
        NanoCpus: z.number(),
      }),
      Mounts: z.array(
        z.object({
          Type: z.string(),
          Source: z.string(),
          Destination: z.string(),
          RW: z.boolean(),
        }),
      ),
      State: z.object({ Running: z.boolean() }),
    }),
  )
  .length(1);
const samePath = (a: string, b: string) =>
  process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;

/** Local Docker CLI adapter. Compatibility remains unverified until engine smoke evidence exists.
 * Lifecycle failures never fall back to host command execution or remove persisted data.
 */
export class IsolatedEnvironments {
  private readonly busy = new Set<string>();
  private readonly pending = new Set<Promise<ComputerEnvironment>>();
  private readonly shutdown = new AbortController();
  private readonly executions = new Set<Promise<unknown>>();
  constructor(
    private readonly store: Store,
    private readonly workspaces: WorkspaceRegistry,
  ) {
    for (const environment of this.list())
      if (["starting", "running", "stopping"].includes(environment.state)) {
        environment.state = "unknown";
        environment.networkEnforcement = "unverified";
        environment.error =
          "Daemon restarted. Inspect the owned container before continuing; no action was replayed.";
        this.persist(environment);
      }
  }
  list() {
    return (
      this.store.db
        .prepare("SELECT data FROM environments ORDER BY rowid DESC")
        .all() as { data: string }[]
    ).map((row) => environmentSchema.parse(JSON.parse(row.data)));
  }
  get(id: string) {
    z.uuid().parse(id);
    const row = this.store.db
      .prepare("SELECT data FROM environments WHERE id=?")
      .get(id) as { data: string } | undefined;
    if (!row)
      throw new RockyError("environment_missing", "Environment not found", 404);
    return environmentSchema.parse(JSON.parse(row.data));
  }
  private receipt(requestId: string, intent: string) {
    const prior = this.store.db
      .prepare(
        "SELECT intent,data FROM environment_receipts WHERE request_id=?",
      )
      .get(requestId) as { intent: string; data: string } | undefined;
    if (!prior) return;
    if (prior.intent !== intent)
      throw new RockyError(
        "idempotency_conflict",
        "Environment command changed",
        409,
      );
    return environmentSchema.parse(JSON.parse(prior.data));
  }
  private persist(
    environment: ComputerEnvironment,
    receipt?: { requestId: string; intent: string },
  ) {
    environment.revision++;
    environment.updatedAt = new Date().toISOString();
    environmentSchema.parse(environment);
    this.store.transaction(() => {
      this.store.db
        .prepare(
          "INSERT INTO environments VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data",
        )
        .run(environment.id, JSON.stringify(environment));
      this.store.db
        .prepare(
          "INSERT INTO environment_events(environment_id,data) VALUES(?,?)",
        )
        .run(
          environment.id,
          JSON.stringify({
            id: randomUUID(),
            at: environment.updatedAt,
            state: environment.state,
            revision: environment.revision,
            containerId: environment.containerId,
            error: environment.error,
          }),
        );
      if (receipt)
        this.store.db
          .prepare(
            "INSERT INTO environment_receipts VALUES(?,?,?) ON CONFLICT(request_id) DO UPDATE SET data=excluded.data",
          )
          .run(receipt.requestId, receipt.intent, JSON.stringify(environment));
    });
    return environment;
  }
  async create(input: unknown) {
    const command = environmentCreateSchema.parse(input),
      intent = intentHash(command);
    const prior = this.receipt(command.requestId, intent);
    if (prior) return prior;
    await this.workspaces.root(
      command.config.workspaceId,
      command.config.workspaceRevision,
    );
    const repeated = this.receipt(command.requestId, intent);
    if (repeated) return repeated;
    if (
      !isAbsolute(command.config.engineExecutable) ||
      /\.(?:cmd|bat|ps1)$/i.test(command.config.engineExecutable)
    )
      throw new RockyError(
        "engine_executable",
        "Select an absolute engine executable, not a shell script",
        422,
      );
    const now = new Date().toISOString();
    return this.persist(
      {
        id: command.requestId,
        revision: 1,
        mode: "isolated",
        config: command.config,
        state: "configured",
        containerId: null,
        engineVersion: null,
        networkEnforcement: "unverified",
        compatibility: "unverified",
        error: null,
        createdAt: now,
        updatedAt: now,
      },
      { requestId: command.requestId, intent },
    );
  }
  private name(environment: ComputerEnvironment) {
    return "rocky-" + environment.id;
  }
  private async engineCommand(
    environment: ComputerEnvironment,
    args: string[],
    signal: AbortSignal,
    timeoutMs = 30000,
    maxOutputBytes = 262144,
  ) {
    const root = await this.workspaces.root(
      environment.config.workspaceId,
      environment.config.workspaceRevision,
    );
    const executable = await realpath(environment.config.engineExecutable);
    const rel = relative(root.root, executable);
    if (!isAbsolute(rel) && rel !== ".." && !rel.startsWith(".." + sep))
      throw new RockyError(
        "engine_executable",
        "Engine executable cannot come from the workspace",
        403,
      );
    if (!(await lstat(executable)).isFile())
      throw new RockyError(
        "engine_unavailable",
        "Engine executable is unavailable",
        422,
      );
    const configRoot = join(this.store.root, "engine-client");
    await mkdir(configRoot, { recursive: true, mode: 0o700 });
    if ((await lstat(configRoot)).isSymbolicLink())
      throw new RockyError(
        "engine_config",
        "Engine configuration path is linked",
        409,
      );
    return new NativeEnvironment().execute(
      {
        executable,
        cwd: configRoot,
        args: [
          "--config",
          configRoot,
          "--host",
          environment.config.endpoint,
          ...args,
        ],
        timeoutMs,
        maxOutputBytes,
      },
      signal,
    );
  }
  private async cli(
    environment: ComputerEnvironment,
    args: string[],
    signal: AbortSignal,
  ) {
    const result = await this.engineCommand(environment, args, signal);
    if (result.reason !== "exited" || result.exitCode !== 0)
      throw new RockyError(
        "engine_unavailable",
        "Local engine command failed or its result is unknown. Inspect before retrying; no Native fallback occurred.",
        409,
      );
    return result.stdout;
  }
  private async inspect(environment: ComputerEnvironment, signal: AbortSignal) {
    const rows = inspectionSchema.parse(
      JSON.parse(
        await this.cli(
          environment,
          [
            "container",
            "inspect",
            environment.containerId ?? this.name(environment),
          ],
          signal,
        ),
      ),
    );
    const value = rows[0]!;
    const root = await this.workspaces.root(
      environment.config.workspaceId,
      environment.config.workspaceRevision,
    );
    const binds = value.Mounts.filter((mount) => mount.Type !== "tmpfs");
    if (
      value.Config.User !== "65534:65534" ||
      !value.HostConfig.CapDrop.some((cap) => cap.toUpperCase() === "ALL") ||
      !value.HostConfig.SecurityOpt.some((option) =>
        /^no-new-privileges(?::true)?$/.test(option),
      ) ||
      value.HostConfig.PidsLimit !== 128 ||
      value.HostConfig.Memory !== environment.config.memoryMiB * 1048576 ||
      value.HostConfig.NanoCpus !== environment.config.cpus * 1e9
    )
      throw new RockyError(
        "environment_policy",
        "Container resource or privilege policy changed",
        409,
      );
    if (
      value.Config.Labels["rocky.environment"] !== environment.id ||
      value.Config.Image !== environment.config.image ||
      (environment.containerId && value.Id !== environment.containerId) ||
      value.HostConfig.NetworkMode !== "none" ||
      value.HostConfig.Privileged ||
      !value.HostConfig.ReadonlyRootfs ||
      binds.length !== 1 ||
      binds[0]!.Type !== "bind" ||
      binds[0]!.Destination !== "/work" ||
      !samePath(binds[0]!.Source, root.root) ||
      !binds[0]!.RW
    )
      throw new RockyError(
        "environment_identity",
        "Container identity or isolation policy does not match. No container action is authorized.",
        409,
      );
    environment.containerId = value.Id;
    environment.state = value.State.Running ? "running" : "stopped";
    environment.networkEnforcement = "container_none";
    return value;
  }
  async command(id: string, input: unknown, signal: AbortSignal) {
    this.shutdown.signal.throwIfAborted();
    const pending = this.perform(
      id,
      input,
      AbortSignal.any([signal, this.shutdown.signal]),
    );
    this.pending.add(pending);
    try {
      return await pending;
    } finally {
      this.pending.delete(pending);
    }
  }
  async close() {
    this.shutdown.abort();
    await Promise.allSettled([...this.pending, ...this.executions]);
  }
  assertWork(
    work: Pick<Work, "environmentId" | "workspaceId" | "workspaceRevision">,
  ) {
    if (!work.environmentId)
      throw new RockyError(
        "environment_scope",
        "No isolated environment selected for this Work",
        403,
      );
    const environment = this.get(work.environmentId);
    if (
      environment.state !== "running" ||
      !environment.containerId ||
      environment.config.workspaceId !== work.workspaceId ||
      environment.config.workspaceRevision !== work.workspaceRevision
    )
      throw new RockyError(
        "environment_unavailable",
        "Selected environment is unavailable or its workspace changed. No Native fallback is permitted.",
        409,
      );
    return environment;
  }
  async execute(
    work: Work,
    input: unknown,
    expectedRevision: number,
    signal: AbortSignal,
  ) {
    const pending = this.executeOwned(
      work,
      input,
      expectedRevision,
      AbortSignal.any([signal, this.shutdown.signal]),
    );
    this.executions.add(pending);
    try {
      return await pending;
    } finally {
      this.executions.delete(pending);
    }
  }
  private async executeOwned(
    work: Work,
    input: unknown,
    expectedRevision: number,
    signal: AbortSignal,
  ) {
    const command = computerCommandSchema.parse(input),
      environment = this.assertWork(work);
    if (
      environment.revision !== expectedRevision ||
      this.busy.has(environment.id)
    )
      throw new RockyError(
        "environment_stale",
        "Environment changed or is busy; prepare a fresh command",
        409,
      );
    this.busy.add(environment.id);
    try {
      await this.inspect(environment, signal);
      if (environment.state !== "running")
        throw new RockyError(
          "environment_unavailable",
          "Container is not running",
          409,
        );
      signal.throwIfAborted();
      const result = await this.engineCommand(
        environment,
        [
          "container",
          "exec",
          "--workdir=/work",
          "--user=65534:65534",
          environment.containerId!,
          command.executable,
          ...command.args,
        ],
        signal,
        command.timeoutMs,
        command.maxOutputBytes,
      );
      if (result.reason !== "exited") {
        // Killing the CLI cannot prove the container process stopped. Stop only this
        // owned environment and inspect; never infer no effect from cancellation.
        try {
          await this.cli(
            environment,
            ["container", "stop", "--time", "5", environment.containerId!],
            AbortSignal.timeout(15000),
          );
          await this.inspect(environment, AbortSignal.timeout(15000));
        } catch {
          environment.state = "unknown";
          environment.networkEnforcement = "unverified";
        }
        environment.error =
          "Command did not complete normally; inspect effects before retrying.";
        this.persist(environment);
      }
      return {
        ...result,
        environmentId: environment.id,
        containerId: environment.containerId,
        isolation: "container",
        networkEnforcement: environment.networkEnforcement,
        untrustedData: true,
      };
    } finally {
      this.busy.delete(environment.id);
    }
  }
  private async perform(id: string, input: unknown, signal: AbortSignal) {
    const command = environmentCommandSchema.parse(input),
      intent = intentHash({ id, ...command });
    const replay = this.receipt(command.requestId, intent);
    if (replay) return replay;
    if (this.busy.has(id))
      throw new RockyError(
        "environment_busy",
        "An environment command is in progress",
        409,
      );
    const environment = this.get(id);
    if (environment.revision !== command.expectedRevision)
      throw new RockyError(
        "environment_stale",
        "Environment revision changed",
        409,
      );
    if (
      command.action === "start" &&
      ["unknown", "starting", "stopping"].includes(environment.state)
    )
      throw new RockyError(
        "environment_unknown",
        "Inspect the prior environment outcome before starting",
        409,
      );
    const receipt = { requestId: command.requestId, intent };
    this.busy.add(id);
    try {
      // Reserve the command identity before any asynchronous engine operation.
      this.persist(environment, receipt);
      const root = await this.workspaces.root(
        environment.config.workspaceId,
        environment.config.workspaceRevision,
      );
      if (root.root.includes(","))
        throw new RockyError(
          "environment_mount",
          "Mount paths containing commas are unsupported",
          422,
        );
      environment.error = null;
      if (command.action === "inspect") await this.inspect(environment, signal);
      else if (command.action === "stop") {
        await this.inspect(environment, signal);
        environment.state = "stopping";
        this.persist(environment, receipt);
        await this.cli(
          environment,
          ["container", "stop", "--time", "10", environment.containerId!],
          signal,
        );
        await this.inspect(environment, signal);
      } else {
        if (environment.containerId) await this.inspect(environment, signal);
        environment.engineVersion = (
          await this.cli(
            environment,
            ["version", "--format", "{{.Server.Version}}"],
            signal,
          )
        )
          .trim()
          .slice(0, 200);
        environment.state = "starting";
        this.persist(environment, receipt);
        if (!environment.containerId) {
          const result = await this.cli(
            environment,
            [
              "container",
              "create",
              "--pull=never",
              "--name",
              this.name(environment),
              "--label",
              `rocky.environment=${id}`,
              "--network=none",
              "--read-only",
              "--cap-drop=ALL",
              "--security-opt=no-new-privileges",
              "--pids-limit=128",
              `--memory=${environment.config.memoryMiB}m`,
              `--cpus=${environment.config.cpus}`,
              "--user=65534:65534",
              "--tmpfs",
              "/tmp:rw,noexec,nosuid,size=64m",
              "--mount",
              `type=bind,source=${root.root},target=/work`,
              "--workdir=/work",
              "--entrypoint=node",
              environment.config.image,
              "-e",
              "setInterval(()=>{},3600000)",
            ],
            signal,
          );
          environment.containerId = z
            .string()
            .regex(/^[a-f0-9]{64}$/)
            .parse(result.trim());
          this.persist(environment, receipt);
        }
        await this.inspect(environment, signal);
        await this.cli(
          environment,
          ["container", "start", environment.containerId!],
          signal,
        );
        const inspected = await this.inspect(environment, signal);
        if (!inspected.State.Running)
          throw new RockyError(
            "environment_start",
            "Container did not remain running",
            409,
          );
      }
      return this.persist(environment, receipt);
    } catch (error) {
      environment.state =
        environment.containerId ||
        ["starting", "stopping"].includes(environment.state)
          ? "unknown"
          : "unavailable";
      environment.networkEnforcement = "unverified";
      environment.error =
        error instanceof RockyError
          ? error.message
          : "Local container engine is unavailable. No host execution fallback occurred.";
      return this.persist(environment, receipt);
    } finally {
      this.busy.delete(id);
    }
  }
}
