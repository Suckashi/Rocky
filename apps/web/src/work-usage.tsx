import { useEffect, useState } from "react";
import { z } from "zod";
import { modelUsageSnapshotSchema } from "../../../packages/contracts/src/model-budget.js";

export function WorkUsage({
  workId,
  revision,
  locale,
  request,
}: {
  workId: string;
  revision: string;
  locale: "zh" | "en";
  request: (path: string, body?: unknown) => Promise<unknown>;
}) {
  const [open, setOpen] = useState(false);
  const [usage, setUsage] = useState<z.infer<
    typeof modelUsageSnapshotSchema
  > | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!open) return;
    let current = true;
    setError("");
    void request(`/works/${workId}/model-usage`)
      .then((value) => {
        if (current) setUsage(modelUsageSnapshotSchema.parse(value));
      })
      .catch((cause: unknown) => {
        if (current) setError(String(cause));
      });
    return () => {
      current = false;
    };
  }, [open, workId, revision, request]);
  const zh = locale === "zh";
  return (
    <details
      className="work-budget"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>{zh ? "模型用量與預算" : "Model usage and budget"}</summary>
      {error && <p role="alert">{error}</p>}
      {usage && (
        <dl>
          <dt>
            {zh
              ? "模型呼叫（含摘要與子工作）"
              : "Model calls (including summaries and children)"}
          </dt>
          <dd>
            {usage.calls} / {usage.budget.maxCalls}
          </dd>
          <dt>
            {zh ? "已知輸入／輸出 tokens" : "Known input / output tokens"}
          </dt>
          <dd>
            {usage.knownUsage.inputTokens} / {usage.knownUsage.outputTokens}
          </dd>
          <dt>{zh ? "用量未確認的呼叫" : "Calls with unconfirmed usage"}</dt>
          <dd>{usage.unknownUsageCalls}</dd>
          <dt>
            {zh
              ? "已使用及保留 tokens／上限"
              : "Consumed and reserved tokens / limit"}
          </dt>
          <dd>
            {usage.heldTokens} / {usage.budget.maxTokens ?? "—"}
          </dd>
          <dt>{zh ? "估算費用（micro-USD）" : "Estimated cost (micro-USD)"}</dt>
          <dd>
            {usage.unknownUsageCalls || usage.knownEstimatedMicroUsd === null
              ? "unknown"
              : usage.knownEstimatedMicroUsd}
          </dd>
          <dt>
            {zh
              ? "已知部分估算（micro-USD）"
              : "Known portion estimate (micro-USD)"}
          </dt>
          <dd>{usage.knownEstimatedMicroUsd ?? "unknown"}</dd>
        </dl>
      )}
    </details>
  );
}
