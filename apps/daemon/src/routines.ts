import { createHash } from "node:crypto";
import { Cron } from "croner";
import { z } from "zod";
import {
  routineSaveSchema,
  routineSchema,
  routineOccurrenceSchema,
  type Routine,
} from "../../../packages/contracts/src/routines.js";
import {
  RockyError,
  type Work,
} from "../../../packages/contracts/src/index.js";
import { Store } from "./store.js";
import { intentHash } from "./intent.js";

const occurrenceId = (key: string) => {
  const hash = createHash("sha256")
    .update("rocky.routine.v1:" + key)
    .digest("hex");
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
};
export class Routines {
  private timer?: ReturnType<typeof setInterval>;
  private ticking = false;
  constructor(
    private readonly store: Store,
    private readonly submit: (input: unknown) => Work,
    private readonly validate: (config: Routine["config"]) => void,
    private readonly now = () => Date.now(),
  ) {}
  list() {
    return (
      this.store.db
        .prepare("SELECT data FROM routines ORDER BY rowid DESC")
        .all() as { data: string }[]
    ).map((row) => routineSchema.parse(JSON.parse(row.data)));
  }
  get(id: string) {
    const value = this.list().find((routine) => routine.id === id);
    if (!value)
      throw new RockyError("routine_missing", "Routine not found", 404);
    return value;
  }
  occurrences(id: string, before?: string) {
    this.get(id);
    if (before) z.iso.datetime().parse(before);
    const rows = this.store.db
      .prepare(
        "SELECT data FROM routine_occurrences WHERE json_extract(data,'$.routineId')=? AND json_extract(data,'$.scheduledAt')<? ORDER BY json_extract(data,'$.scheduledAt') DESC LIMIT 51",
      )
      .all(id, before ?? "9999-12-31T23:59:59.999Z") as { data: string }[];
    const occurrences = rows.slice(0, 50).map((row) => {
      const { submission: _submission, ...value } =
        routineOccurrenceSchema.parse(JSON.parse(row.data));
      void _submission;
      return value;
    });
    return {
      occurrences,
      nextBefore: rows.length > 50 ? occurrences.at(-1)!.scheduledAt : null,
    };
  }
  private next(routine: Pick<Routine, "config" | "createdAt">, after: number) {
    const { schedule, timezone } = routine.config;
    if (schedule.kind === "interval") {
      const anchor = Date.parse(routine.createdAt),
        interval = schedule.seconds * 1000;
      return new Date(
        anchor + (Math.floor((after - anchor) / interval) + 1) * interval,
      ).toISOString();
    }
    const cron = new Cron(schedule.expression, { timezone, paused: true });
    try {
      return cron.nextRun(new Date(after))?.toISOString() ?? null;
    } finally {
      cron.stop();
    }
  }
  private latest(routine: Routine, now: number) {
    const { schedule, timezone } = routine.config;
    if (schedule.kind === "interval") {
      const anchor = Date.parse(routine.createdAt),
        interval = schedule.seconds * 1000;
      return new Date(
        anchor + Math.floor((now - anchor) / interval) * interval,
      ).toISOString();
    }
    const cron = new Cron(schedule.expression, { timezone, paused: true });
    try {
      return (
        cron.previousRuns(1, new Date(now + 1))[0]?.toISOString() ??
        routine.nextAt!
      );
    } finally {
      cron.stop();
    }
  }
  save(input: unknown) {
    const command = routineSaveSchema.parse(input),
      intent = intentHash(command);
    const previous = this.store.db
      .prepare("SELECT intent,data FROM routine_receipts WHERE request_id=?")
      .get(command.requestId) as { intent: string; data: string } | undefined;
    if (previous) {
      if (previous.intent !== intent)
        throw new RockyError(
          "idempotency_conflict",
          "Routine request changed",
          409,
        );
      return routineSchema.parse(JSON.parse(previous.data));
    }
    if (command.config.enabled) this.validate(command.config);
    const old = this.list().find((routine) => routine.id === command.id);
    if ((old?.revision ?? 0) !== command.expectedRevision)
      throw new RockyError("routine_stale", "Routine changed", 409);
    if (!old && this.list().length >= 100)
      throw new RockyError("routine_capacity", "Routine limit reached", 422);
    const now = new Date(this.now()).toISOString();
    const routine: Routine = {
      id: command.id,
      revision: command.expectedRevision + 1,
      config: command.config,
      nextAt: null,
      lastOccurrenceKey: old?.lastOccurrenceKey ?? null,
      lastWorkId: old?.lastWorkId ?? null,
      error: null,
      createdAt: old?.createdAt ?? now,
      updatedAt: now,
    };
    try {
      routine.nextAt = this.next(routine, this.now());
    } catch {
      throw new RockyError(
        "routine_schedule",
        "Cron expression or timezone is invalid",
        422,
      );
    }
    if (!routine.nextAt)
      throw new RockyError(
        "routine_schedule",
        "Schedule has no future occurrence",
        422,
      );
    return this.store.transaction(() => {
      this.store.db
        .prepare(
          "INSERT INTO routines VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data",
        )
        .run(routine.id, JSON.stringify(routine));
      this.store.db
        .prepare("INSERT INTO routine_receipts VALUES(?,?,?)")
        .run(command.requestId, intent, JSON.stringify(routine));
      return routine;
    });
  }
  start() {
    if (this.timer) return;
    this.tick();
    this.timer = setInterval(() => this.tick(), 15000);
    this.timer.unref();
  }
  close() {
    clearInterval(this.timer);
    this.timer = undefined;
  }
  tick() {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const now = this.now();
      for (const routine of this.list()) {
        if (
          !routine.config.enabled ||
          !routine.nextAt ||
          Date.parse(routine.nextAt) > now
        )
          continue;
        const due = routine.nextAt,
          missed = now - Date.parse(due) >= 60000;
        const scheduledAt =
          missed && routine.config.misfirePolicy === "coalesce-one"
            ? this.latest(routine, now)
            : due;
        const key = `${routine.id}:${routine.revision}:${scheduledAt}`,
          id = occurrenceId(key);
        const occurrence = routineOccurrenceSchema.parse({
          id,
          routineId: routine.id,
          routineRevision: routine.revision,
          scheduledAt,
          occurrenceKey: key,
          status:
            missed && routine.config.misfirePolicy === "skip"
              ? "skipped"
              : "pending",
          workId: null,
          error: null,
          submission: {
            requestId: id,
            text: routine.config.prompt,
            mode: "configured",
            transport: "http",
            kind: "background",
            modelSelection: routine.config.modelSelection,
            modelBudget: routine.config.modelBudget,
            ...(routine.config.workspaceId
              ? {
                  workspaceId: routine.config.workspaceId,
                  workspaceRevision: routine.config.workspaceRevision,
                  workspaceRead: routine.config.workspaceRead,
                }
              : {}),
          },
        });
        routine.lastOccurrenceKey = key;
        routine.nextAt = this.next(routine, now);
        routine.updatedAt = new Date(now).toISOString();
        this.store.transaction(() => {
          this.store.db
            .prepare("INSERT OR IGNORE INTO routine_occurrences VALUES(?,?,?)")
            .run(id, key, JSON.stringify(occurrence));
          this.store.db
            .prepare("UPDATE routines SET data=? WHERE id=?")
            .run(JSON.stringify(routine), routine.id);
        });
      }
      const pending = this.store.db
        .prepare(
          "SELECT data FROM routine_occurrences WHERE json_extract(data,'$.status')='pending' ORDER BY rowid LIMIT 100",
        )
        .all() as { data: string }[];
      for (const row of pending) {
        const occurrence = routineOccurrenceSchema.parse(JSON.parse(row.data)),
          routine = this.get(occurrence.routineId);
        let submittedWork: Work | undefined;
        try {
          const prior = this.store.receipt(occurrence.id);
          if (
            !prior &&
            (!routine.config.enabled ||
              routine.revision !== occurrence.routineRevision)
          )
            occurrence.status = "skipped";
          else {
            const work = prior
              ? this.store.get(prior.id)
              : this.submit(occurrence.submission);
            occurrence.workId = work.id;
            occurrence.status = "submitted";
            routine.lastWorkId = work.id;
            routine.error = null;
            submittedWork = work;
          }
        } catch (error) {
          occurrence.status = "failed";
          occurrence.error =
            error instanceof RockyError
              ? error.message
              : "Routine admission failed";
          routine.error = occurrence.error;
        }
        this.store.transaction(() => {
          if (submittedWork)
            this.store.event(
              this.store.get(submittedWork.id),
              "rocky.routine.submitted",
              {
                routineId: routine.id,
                routineRevision: occurrence.routineRevision,
                scheduledOccurrenceId: occurrence.id,
                scheduledAt: occurrence.scheduledAt,
              },
            );
          this.store.db
            .prepare("UPDATE routine_occurrences SET data=? WHERE id=?")
            .run(JSON.stringify(occurrence), occurrence.id);
          this.store.db
            .prepare("UPDATE routines SET data=? WHERE id=?")
            .run(JSON.stringify(routine), routine.id);
        });
      }
      this.lastError = null;
    } catch (error) {
      // A bounded scheduler failure is visible; never dispatch guessed occurrences.
      this.lastError =
        error instanceof Error ? error.message : "Routine scheduler failed";
    } finally {
      this.ticking = false;
    }
  }
  lastError: string | null = null;
}
