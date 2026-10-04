import { test, expect } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { PNG } from "pngjs";
import {
  rokoManifest as manifest,
  rokoFrame,
  rokoPlayback,
  type RokoClip,
} from "../apps/web/src/roko-animation.js";

test("Roko original hash, dimensions and all manifest frames have visible pixels and remain inside the atlas", () => {
  const bytes = readFileSync(`assets/roko/${manifest.image.file}`);
  expect(createHash("sha256").update(bytes).digest("hex")).toBe(
    manifest.image.sha256,
  );
  expect(bytes.length).toBe(manifest.image.sizeBytes);
  const png = PNG.sync.read(bytes);
  expect([png.width, png.height]).toEqual([
    manifest.image.width,
    manifest.image.height,
  ]);
  expect(manifest.grid.columns * manifest.grid.cellWidth).toBe(png.width);
  expect(manifest.grid.rows * manifest.grid.cellHeight).toBe(png.height);
  for (const [clip, animation] of Object.entries(manifest.animations)) {
    for (let i = 0; i < animation.columns.length; i++) {
      const frame = rokoFrame(clip as RokoClip, i * 125, "loop");
      expect(frame.column).toBe(animation.columns[i]);
      let opaque = 0;
      for (let y = frame.y; y < frame.y + manifest.grid.cellHeight; y++)
        for (let x = frame.x; x < frame.x + manifest.grid.cellWidth; x++) {
          expect(x < png.width && y < png.height).toBe(true);
          if (png.data[(y * png.width + x) * 4 + 3]) opaque++;
        }
      expect(opaque).toBeGreaterThan(100);
    }
    expect(
      rokoFrame(clip as RokoClip, animation.columns.length * 125, "loop")
        .column,
    ).toBe(animation.columns[0]);
    expect(rokoFrame(clip as RokoClip, 100000, "once").column).toBe(
      animation.columns.at(-1),
    );
    expect(rokoFrame(clip as RokoClip, 100000, "static").column).toBe(
      animation.columns[0],
    );
  }
});

test("Roko activity stays a projection; terminal and uncertain states never run or celebrate", () => {
  const model = { state: "running", moving: true, connected: true };
  expect(rokoPlayback(model, false)).toEqual({ clip: "running", mode: "loop" });
  expect(rokoPlayback({ ...model, activity: "review" }, false).clip).toBe(
    "review",
  );
  for (const state of [
    "idle",
    "setup_required",
    "waiting_resource",
    "waiting_model",
    "queued",
    "awaiting_approval",
    "cancelled",
    "interrupted",
    "blocked",
    "stale",
    "failed",
  ])
    expect(rokoPlayback({ ...model, state }, true).mode).toBe("static");
  expect(
    rokoPlayback({ ...model, connected: false, moving: false }, false).mode,
  ).toBe("static");
  expect(rokoPlayback({ ...model, state: "completed" }, true)).toEqual({
    clip: "jumping",
    mode: "once",
  });
  expect(rokoPlayback({ ...model, state: "completed" }, false).clip).toBe(
    "idle",
  );
});
