// Application-owned evaluator. Only case indices and variant names cross IPC.
// No model-generated JS, YAML, provider path, grader, or assertion is accepted.
process.env.PROMPTFOO_DISABLE_TELEMETRY = "1";
process.env.PROMPTFOO_DISABLE_UPDATE = "1";
process.env.SCARF_NO_ANALYTICS = "true";
process.env.LANGSMITH_TRACING = "false";
process.env.LANGCHAIN_TRACING_V2 = "false";
process.env.PROMPTFOO_DISABLE_SHARING = "1";
process.env.PROMPTFOO_DISABLE_REDTEAM_REMOTE_GENERATION = "1";
process.env.PROMPTFOO_DISABLE_REMOTE_GENERATION = "1";
process.env.PROMPTFOO_DISABLE_TEMPLATE_ENV_VARS = "1";
const pending = new Map();
let serial = 0,
  started = false;
process.on("message", async (message) => {
  if (message?.kind === "case_result") {
    const callback = pending.get(message.id);
    if (!callback) return;
    pending.delete(message.id);
    callback(
      message.error
        ? { error: message.error }
        : { output: JSON.stringify(message.result) },
    );
    return;
  }
  if (message?.kind !== "start" || started) return;
  started = true;
  try {
    if (
      !Array.isArray(message.cases) ||
      message.cases.length > 3000 ||
      message.cases.some(
        (item) =>
          !Number.isSafeInteger(item.index) ||
          !Number.isSafeInteger(item.repetition) ||
          item.repetition < 0 ||
          item.repetition > 9 ||
          !["baseline", "current", "candidate"].includes(item.variant),
      )
    )
      throw Error("Invalid trusted evaluation plan");
    const { evaluate } = await import("promptfoo");
    const provider = async (prompt) => {
      const item = JSON.parse(prompt);
      if (
        !message.cases.some(
          (allowed) =>
            allowed.index === item.index &&
            allowed.variant === item.variant &&
            allowed.repetition === item.repetition,
        )
      )
        throw Error("Case is outside trusted plan");
      const id = ++serial;
      return new Promise((resolve) => {
        pending.set(id, resolve);
        process.send?.({
          kind: "case",
          id,
          index: item.index,
          variant: item.variant,
          repetition: item.repetition,
        });
      });
    };
    const result = await evaluate(
      {
        writeLatestResults: false,
        prompts: ["{{case}}"],
        providers: [provider],
        tests: message.cases.map((item) => ({
          vars: { case: JSON.stringify(item) },
          assert: [
            {
              type: "javascript",
              value:
                "JSON.parse(output).passed === true && JSON.parse(output).safetyPassed === true",
            },
          ],
        })),
      },
      {
        cache: false,
        maxConcurrency: 1,
        showProgressBar: false,
        generateSuggestions: false,
      },
    );
    const summary = await result.toEvaluateSummary();
    process.send?.({ kind: "complete", stats: summary.stats }, () =>
      process.disconnect(),
    );
  } catch (error) {
    process.send?.(
      {
        kind: "failed",
        error: error instanceof Error ? error.message : "Evaluator failed",
      },
      () => process.disconnect(),
    );
  }
});
