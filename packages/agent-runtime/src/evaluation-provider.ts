import "./environment.js";
import { randomUUID } from "node:crypto";
import type { WorkService } from "../../../apps/daemon/src/work-service.js";
import { z } from "zod";
const caseSchema = z
  .object({
    transport: z.enum(["stdio", "http"]),
    decision: z.enum(["approve", "reject"]),
  })
  .strict();
export class RockyEvaluationProvider {
  constructor(private readonly service: WorkService) {}
  id() {
    return "rocky-reflection";
  }
  async callApi(prompt: string) {
    const input = caseSchema.parse(JSON.parse(prompt));
    const work = this.service.submit(
      {
        requestId: randomUUID(),
        text: "Evaluate native fixture workflow",
        mode: "fixture",
        transport: input.transport,
      },
      "evaluation",
    );
    for (let i = 0; i < 500; i++) {
      const current = this.service.store.get(work.id);
      if (current.status === "waiting_approval") {
        // This trusted suite owns synthetic-only effect approval, never a production owner grant.
        this.service.decide(work.id, {
          requestId: randomUUID(),
          expectedRevision: current.approval!.revision,
          intentFingerprint: current.approval!.intentFingerprint,
          decision: input.decision,
        });
      }
      if (current.status === "completed") {
        const evidence = this.service.store.eventsForWork(work.id);
        return {
          output: JSON.stringify({
            status: current.status,
            decision: input.decision,
            writes: evidence.filter(
              (e) =>
                e.name === "rocky.operation.succeeded" &&
                e.data.name === "write_sample",
            ).length,
            childCompleted: evidence.some(
              (e) => e.name === "rocky.subagent.completed",
            ),
            answer: current.answer,
          }),
          metadata: {
            workId: work.id,
            mode: "fixture",
            eventIds: evidence.map((e) => e.id),
          },
        };
      }
      if (["failed", "blocked", "cancelled"].includes(current.status))
        return { error: current.error ?? current.status };
      await new Promise((r) => setTimeout(r, 20));
    }
    const current = this.service.store.get(work.id);
    if (["queued", "running", "waiting_approval"].includes(current.status))
      this.service.stop(work.id, {
        requestId: randomUUID(),
        runId: current.runId,
        executionSessionId: current.executionSessionId,
        expectedRevision: current.revision,
      });
    return { error: "Evaluation timed out" };
  }
}
