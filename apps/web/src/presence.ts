import type {
  Work,
  PublicEvent,
} from "../../../packages/contracts/src/index.js";
export type PresenceInput = {
  works: Work[];
  events: PublicEvent[];
  connected: boolean;
  configured: boolean;
  animationsEnabled: boolean;
  reducedMotion: boolean;
  hidden: boolean;
};
const progressNames = new Set([
  "rocky.model.started",
  "rocky.model.completed",
  "rocky.model.stream",
  "rocky.tool.started",
  "rocky.tool.completed",
  "rocky.tool.failed",
  "rocky.subagent.started",
  "rocky.subagent.completed",
  "rocky.subagent.failed",
]);
export function deriveRockyPresence(input: PresenceInput, now: number) {
  const works = input.works.filter((w) => w.runMode === "normal");
  const foreground = works
    .filter((w) => w.kind !== "background")
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0];
  const background = works.filter((w) => w.kind === "background");
  const counts = {
    running: background.filter((w) => w.status === "running").length,
    queued: background.filter((w) => w.status === "queued").length,
    approval: background.filter((w) => w.status === "waiting_approval").length,
    attention: background.filter((w) =>
      ["failed", "interrupted", "blocked"].includes(w.status),
    ).length,
  };
  const evidence = foreground
    ? input.events.filter(
        (e) =>
          e.workId === foreground.id &&
          e.runId === foreground.runId &&
          e.executionSessionId === foreground.executionSessionId &&
          e.payload.kind === "domain" &&
          progressNames.has(e.payload.name),
      )
    : [];
  const lastProgressAt = evidence.reduce<number | null>(
    (last, e) => Math.max(last ?? 0, Date.parse(e.timestamp)),
    null,
  );
  const active = new Map<
    string,
    "model" | "tool" | "read" | "review" | "subagent"
  >();
  for (const event of evidence) {
    if (event.payload.kind !== "domain") continue;
    const { name, data } = event.payload;
    const category = name.split(".")[1];
    const key = JSON.stringify([
      event.subagentId,
      category,
      data.callId ?? data.requestId,
    ]);
    if (
      name.endsWith(".completed") ||
      name.endsWith(".failed") ||
      (name === "rocky.model.stream" && data.phase === "end")
    )
      active.delete(key);
    else if (name.endsWith(".started") || name === "rocky.model.stream") {
      // Only explicit executed tool identities can advertise review/read activity.
      const tool = typeof data.name === "string" ? data.name : "";
      active.set(
        key,
        category === "model"
          ? "model"
          : category === "subagent"
            ? "subagent"
            : ["read_file", "workspace_read"].includes(tool)
              ? "read"
              : ["workspace_diff"].includes(tool)
                ? "review"
                : "tool",
      );
    }
  }
  const activity =
    [...active.values()].find((value) => value !== "model") ??
    active.values().next().value;
  let state: string =
    foreground?.status ?? (input.configured ? "idle" : "setup_required");
  if (
    state === "running" &&
    (lastProgressAt === null || now - lastProgressAt > 60000)
  )
    state = "stale";
  if (state === "waiting_approval") state = "awaiting_approval";
  if (state === "queued" && foreground?.waitingFor === "workspace")
    state = "waiting_resource";
  if (foreground?.status === "running") {
    const waits = new Set<string>();
    for (const event of input.events) {
      if (
        event.workId !== foreground.id ||
        event.runId !== foreground.runId ||
        event.executionSessionId !== foreground.executionSessionId ||
        event.payload.kind !== "domain" ||
        event.payload.name !== "rocky.model.wait"
      )
        continue;
      const { requestId, waiting } = event.payload.data;
      if (typeof requestId !== "string") continue;
      if (waiting === true) waits.add(requestId);
      else waits.delete(requestId);
    }
    if ((foreground.modelWaitCount ?? waits.size) > 0) state = "waiting_model";
  }
  return {
    state,
    connected: input.connected,
    foregroundId: foreground?.id,
    counts,
    lastProgressAt,
    activity,
    moving:
      state === "running" &&
      active.size > 0 &&
      input.connected &&
      input.animationsEnabled &&
      !input.reducedMotion &&
      !input.hidden,
  };
}
