import manifest from "../../../assets/roko/roko-manifest.json" with { type: "json" };

export const rokoManifest = manifest;
export type RokoClip = keyof typeof manifest.animations;
export type RokoPlayback = { clip: RokoClip; mode: "static" | "loop" | "once" };
export const completionDuration =
  (manifest.animations.jumping.columns.length /
    manifest.playback.suggestedStartingFps) *
  1000;

export function rokoFrame(
  clip: RokoClip,
  elapsed: number,
  mode: RokoPlayback["mode"],
) {
  const animation = manifest.animations[clip];
  const tick = Math.floor(
    (Math.max(0, elapsed) * manifest.playback.suggestedStartingFps) / 1000,
  );
  const index =
    mode === "static"
      ? 0
      : mode === "loop"
        ? tick % animation.columns.length
        : Math.min(tick, animation.columns.length - 1);
  return {
    row: animation.row,
    column: animation.columns[index],
    x: animation.columns[index] * manifest.grid.cellWidth,
    y: animation.row * manifest.grid.cellHeight,
  };
}

export function rokoPlayback(
  model: {
    state: string;
    moving: boolean;
    connected: boolean;
    activity?: string;
  },
  celebrating: boolean,
): RokoPlayback {
  if (celebrating && model.connected && model.state === "completed")
    return { clip: "jumping", mode: "once" };
  if (model.state === "failed") return { clip: "failed", mode: "static" };
  if (
    [
      "queued",
      "waiting_resource",
      "waiting_model",
      "awaiting_approval",
      "blocked",
      "interrupted",
      "stale",
    ].includes(model.state)
  )
    return { clip: "waiting", mode: "static" };
  if (model.state === "running")
    return {
      clip: model.activity === "review" ? "review" : "running",
      mode: model.moving ? "loop" : "static",
    };
  return { clip: "idle", mode: "static" };
}
