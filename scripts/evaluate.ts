import "../packages/agent-runtime/src/environment.js";
import { resolve, join } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
import { installEvaluationEgressGuard } from "../packages/agent-runtime/src/evaluation-egress.js";
const egress = installEvaluationEgressGuard();
const root = resolve(process.env.ROCKY_EVAL_DIR ?? ".rocky-eval");
mkdirSync(root, { recursive: true });
process.env.PROMPTFOO_CONFIG_DIR = join(root, "promptfoo");
process.env.PROMPTFOO_CACHE_PATH = join(root, "cache");
process.env.PROMPTFOO_DISABLE_SHARING = "1";
process.env.PROMPTFOO_DISABLE_REDTEAM_REMOTE_GENERATION = "1";
process.env.PROMPTFOO_DISABLE_REMOTE_GENERATION = "1";
process.env.PROMPTFOO_DISABLE_TEMPLATE_ENV_VARS = "1";
const { evaluate } = await import("promptfoo");
const { WorkService } = await import("../apps/daemon/src/work-service.js");
const { RockyEvaluationProvider } =
  await import("../packages/agent-runtime/src/evaluation-provider.js");
const service = new WorkService(join(root, "work"));
try {
  const { modelSelectionSchema } =
    await import("../packages/contracts/src/index.js");
  const target = process.env.ROCKY_EVAL_MODEL_SELECTION
    ? {
        mode: "configured" as const,
        modelSelection: modelSelectionSchema.parse(
          JSON.parse(process.env.ROCKY_EVAL_MODEL_SELECTION),
        ),
      }
    : { mode: "fixture" as const };
  const { modelBudgetSchema } =
    await import("../packages/contracts/src/model-budget.js");
  const modelBudget = process.env.ROCKY_EVAL_MODEL_BUDGET
    ? modelBudgetSchema.parse(JSON.parse(process.env.ROCKY_EVAL_MODEL_BUDGET))
    : undefined;
  const provider = new RockyEvaluationProvider(service, {
    ...target,
    ...(modelBudget ? { modelBudget } : {}),
  });
  const cases = (["stdio", "http"] as const).flatMap((transport) =>
    (["approve", "reject"] as const).map((decision) => ({
      vars: { case: JSON.stringify({ transport, decision }) },
      assert: [
        {
          type: "javascript" as const,
          value: `JSON.parse(output).status === "completed" && JSON.parse(output).childCompleted === true && JSON.parse(output).writes === ${decision === "approve" ? 1 : 0}`,
        },
      ],
    })),
  );
  const result = await evaluate(
    {
      prompts: ["{{case}}"],
      providers: [provider.callApi.bind(provider)],
      tests: cases,
    },
    {
      cache: false,
      maxConcurrency: 1,
      showProgressBar: false,
      generateSuggestions: false,
    },
  );
  const summary = await result.toEvaluateSummary();
  writeFileSync(join(root, "report.json"), JSON.stringify(summary, null, 2));
  console.log(
    JSON.stringify({
      stats: summary.stats,
      report: join(root, "report.json"),
      mode: target.mode,
      limitation:
        "Four development cases, not sufficient evidence for publishing a learned skill.",
    }),
  );
  if (summary.stats.failures || summary.stats.errors) process.exitCode = 1;
} finally {
  await service.close();
  writeFileSync(
    join(root, "egress-guard.json"),
    JSON.stringify(
      {
        denied: egress.denied,
        policy: "exact configured evaluation model and fixture endpoints only",
        limitation: "Process Fetch boundary; no OS sandbox claim",
      },
      null,
      2,
    ),
  );
}
