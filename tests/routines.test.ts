import { test, expect } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { Store } from "../apps/daemon/src/store.js";
import { Routines } from "../apps/daemon/src/routines.js";
import {
  submissionSchema,
  type Work,
} from "../packages/contracts/src/index.js";
import { modelBudgetSchema } from "../packages/contracts/src/model-budget.js";

test.each(["skip", "coalesce-one"] as const)(
  "durable interval occurrences, restart and dedupe: %s",
  async (misfirePolicy) => {
    const root = await mkdtemp(join(tmpdir(), "rocky-routines-"));
    let store = new Store(root),
      now = Date.parse("2026-10-04T00:00:00.000Z");
    const submit = (input: unknown) => {
      const command = submissionSchema.parse(input);
      const work: Work = {
        id: randomUUID(),
        runId: randomUUID(),
        executionSessionId: randomUUID(),
        requestId: command.requestId,
        text: command.text,
        transport: command.transport,
        mode: command.mode,
        kind: command.kind,
        modelSelection: command.modelSelection,
        modelBudget: command.modelBudget,
        runMode: "normal",
        revision: 1,
        status: "queued",
        answer: "",
        createdAt: new Date(now).toISOString(),
      };
      store.add(work, work.requestId);
      return work;
    };
    let routines = new Routines(
      store,
      submit,
      () => undefined,
      () => now,
    );
    try {
      const routine = routines.save({
        requestId: randomUUID(),
        id: randomUUID(),
        expectedRevision: 0,
        config: {
          name: "Fixture",
          prompt: "Synthetic only",
          timezone: "Asia/Taipei",
          schedule: { kind: "interval", seconds: 60 },
          misfirePolicy,
          enabled: true,
          modelSelection: { connectionId: randomUUID(), revision: 1 },
          modelBudget: modelBudgetSchema.parse({}),
        },
      });
      now += 60000;
      routines.tick();
      routines.tick();
      expect(store.list()).toHaveLength(1);
      const first = store.list()[0]!;
      expect(first.kind).toBe("background");
      routines.close();
      store.close();
      store = new Store(root);
      routines = new Routines(
        store,
        submit,
        () => undefined,
        () => now,
      );
      now += 3600000;
      routines.tick();
      routines.tick();
      expect(store.list()).toHaveLength(misfirePolicy === "skip" ? 1 : 2);
      const history = routines.occurrences(routine.id).occurrences;
      expect(new Set(history.map((entry) => entry.id)).size).toBe(
        history.length,
      );
      const current = routines.get(routine.id);
      routines.save({
        requestId: randomUUID(),
        id: current.id,
        expectedRevision: current.revision,
        config: { ...current.config, enabled: false },
      });
      now += 60000;
      routines.tick();
      expect(store.list()).toHaveLength(misfirePolicy === "skip" ? 1 : 2);
      expect(routines.lastError).toBeNull();
    } finally {
      routines.close();
      store.close();
      await rm(root, { recursive: true, force: true });
    }
  },
);

test("cron uses IANA local time across DST and does not duplicate one occurrence", async () => {
  const root = await mkdtemp(join(tmpdir(), "rocky-routine-dst-")),
    store = new Store(root);
  let now = Date.parse("2026-03-07T14:00:01Z");
  const routines = new Routines(
    store,
    () => {
      throw new Error("No model is invoked in calendar fixture");
    },
    () => undefined,
    () => now,
  );
  try {
    const command = {
      requestId: randomUUID(),
      id: randomUUID(),
      expectedRevision: 0,
      config: {
        name: "DST",
        prompt: "Synthetic",
        timezone: "America/New_York",
        schedule: { kind: "cron", expression: "0 9 * * *" },
        enabled: false,
        modelSelection: { connectionId: randomUUID(), revision: 1 },
        modelBudget: modelBudgetSchema.parse({}),
      },
    };
    const value = routines.save(command);
    expect(value.nextAt).toBe("2026-03-08T13:00:00.000Z");
    now = Date.parse("2026-10-31T13:00:01Z");
    const fall = routines.save({
      ...command,
      requestId: randomUUID(),
      expectedRevision: value.revision,
    });
    expect(fall.nextAt).toBe("2026-11-01T14:00:00.000Z");
    expect(() =>
      routines.save({
        ...command,
        requestId: randomUUID(),
        expectedRevision: fall.revision,
        config: { ...command.config, timezone: "Not/AZone" },
      }),
    ).toThrow();
  } finally {
    routines.close();
    store.close();
    await rm(root, { recursive: true, force: true });
  }
});
