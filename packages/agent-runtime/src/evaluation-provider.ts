import "./environment.js";
import { randomUUID } from "node:crypto";
import type { WorkService } from "../../../apps/daemon/src/work-service.js";
import { z } from "zod";
import { modelSelectionSchema } from "../../contracts/src/index.js";
import { allowEvaluationEndpoint } from "./evaluation-egress.js";
const targetSchema = z.discriminatedUnion("mode", [
  z.strictObject({ mode: z.literal("fixture") }),
  z.strictObject({
    mode: z.literal("configured"),
    modelSelection: modelSelectionSchema,
  }),
]);
const caseSchema = z
  .object({
    transport: z.enum(["stdio", "http"]),
    decision: z.enum(["approve", "reject"]),
  })
  .strict();
export class RockyEvaluationProvider {
  private readonly target: z.infer<typeof targetSchema>;
  constructor(
    private readonly service: WorkService,
    target: z.infer<typeof targetSchema> = { mode: "fixture" },
  ) {
    // Trusted suite configuration only. Prompt/case text cannot select a provider.
    this.target = targetSchema.parse(target);
  }
  id() {
    return "rocky-reflection";
  }
  async callApi(prompt: string) {
    const input = caseSchema.parse(JSON.parse(prompt));
    let revoke = () => {};
    if (this.target.mode === "configured") {
      const selection = this.target.modelSelection;
      const { config } = this.service.models.assertRunnable(
        selection.connectionId,
        selection.revision,
      );
      revoke = allowEvaluationEndpoint(
        config.baseUrl +
          (config.provider === "anthropic" ? "/messages" : "/chat/completions"),
      );
    }
    try {
      return await this.run(input);
    } finally {
      revoke();
    }
  }
  private async run(input: z.infer<typeof caseSchema>) {
    const work = this.service.submit(
      {
        requestId: randomUUID(),
        text: "Use a native task to inspect the synthetic sample, then write the synthetic sample after approval. Report the result.",
        ...this.target,
        transport: input.transport,
      },
      "evaluation",
    );
    for (let i = 0; i < 500; i++) {
      const current = this.service.store.get(work.id);
      if (current.status === "waiting_approval") {
        if (current.approval?.tool !== "write_sample") {
          this.service.stop(work.id, {
            requestId: randomUUID(),
            runId: current.runId,
            executionSessionId: current.executionSessionId,
            expectedRevision: current.revision,
          });
          return { error: "Evaluation cannot approve non-sample tools" };
        }
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
                e.payload.kind === "domain" &&
                e.payload.name === "rocky.operation.succeeded" &&
                e.payload.kind === "domain" &&
                e.payload.data.name === "write_sample",
            ).length,
            childCompleted: evidence.some(
              (e) =>
                e.payload.kind === "domain" &&
                e.payload.name === "rocky.subagent.completed",
            ),
            answer: current.answer,
          }),
          metadata: {
            workId: work.id,
            mode: this.target.mode,
            modelSelection: current.modelSelection ?? null,
            usage: this.service.modelBudgets.snapshot(current.runId),
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
