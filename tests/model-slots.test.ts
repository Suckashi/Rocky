import { test, expect } from "vitest";
import { ModelSlots } from "../apps/daemon/src/model-slots.js";

test("T-010 model slots prefer main, then background, then evaluation at dispatch boundaries", async () => {
  const slots = new ModelSlots(1);
  const started: string[] = [];
  const releases = new Map<string, () => void>();
  const run = (kind: "main" | "background" | "evaluation", name: string) =>
    slots.run(kind, new AbortController().signal, async () => {
      started.push(name);
      await new Promise<void>((resolve) => releases.set(name, resolve));
    });
  const first = run("background", "first");
  await expect.poll(() => started).toEqual(["first"]);
  const evaluation = run("evaluation", "evaluation");
  const background = run("background", "background");
  const main = run("main", "main");
  expect(slots.snapshot).toEqual({ active: 1, waiting: 3 });
  releases.get("first")!();
  await first;
  await expect.poll(() => started).toEqual(["first", "main"]);
  releases.get("main")!();
  await main;
  await expect.poll(() => started).toEqual(["first", "main", "background"]);
  releases.get("background")!();
  await background;
  await expect
    .poll(() => started)
    .toEqual(["first", "main", "background", "evaluation"]);
  releases.get("evaluation")!();
  await evaluation;
  expect(slots.snapshot).toEqual({ active: 0, waiting: 0 });
});

test("T-010 cancelling a model waiter removes it without consuming a slot", async () => {
  const slots = new ModelSlots(1);
  let releaseFirst!: () => void;
  const first = slots.run(
    "background",
    new AbortController().signal,
    () =>
      new Promise<void>((resolve) => {
        releaseFirst = resolve;
      }),
  );
  await expect.poll(() => slots.snapshot.active).toBe(1);
  const cancel = new AbortController();
  const waits: boolean[] = [];
  const waiting = slots.run(
    "main",
    cancel.signal,
    async () => {},
    (value) => waits.push(value),
  );
  expect(slots.snapshot.waiting).toBe(1);
  cancel.abort(Error("stopped"));
  await expect(waiting).rejects.toThrow("stopped");
  expect(waits).toEqual([true, false]);
  expect(slots.snapshot).toEqual({ active: 1, waiting: 0 });
  releaseFirst();
  await first;
  expect(slots.snapshot).toEqual({ active: 0, waiting: 0 });
});
