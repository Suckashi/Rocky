import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import {
  workSchema,
  type Work,
  type PublicEvent,
} from "../../../packages/contracts/src/index.js";
import { retryReviewSchema } from "../../../packages/contracts/src/operations.js";
export function WorkRetry({
  work,
  events,
  locale,
  connected,
  request,
}: {
  work: Work;
  events: PublicEvent[];
  locale: "zh" | "en";
  connected: boolean;
  request: (path: string, body?: unknown) => Promise<unknown>;
}) {
  const [open, setOpen] = useState(false),
    [review, setReview] = useState<z.infer<typeof retryReviewSchema> | null>(
      null,
    ),
    [confirmed, setConfirmed] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [created, setCreated] = useState<Work | null>(null);
  const attempt = useRef<{ key: string; requestId: string } | null>(null);
  const reconciliationSequence = events.findLast(
    (e) =>
      e.payload.kind === "domain" &&
      e.payload.name === "rocky.operation.reconciled",
  )?.sequence;
  useEffect(() => {
    if (!open) return;
    let live = true;
    setReview(null);
    setConfirmed(false);
    setError("");
    void request(`/works/${work.id}/retry-review`)
      .then((value) => {
        const parsed = retryReviewSchema.parse(value);
        if (live) setReview(parsed);
      })
      .catch((e) => {
        if (live) setError(String(e));
      });
    return () => {
      live = false;
    };
  }, [open, work.id, work.revision, reconciliationSequence, request]);
  if (
    work.runMode !== "normal" ||
    ["queued", "running", "waiting_approval"].includes(work.status)
  )
    return null;
  const unknown = review?.effects.some(
    (e) => e.outcome === "unknown" || e.phase === "dispatched",
  );
  const known =
    review?.effects.filter((e) => e.outcome !== "not_executed") ?? [];
  return (
    <details
      className="work-steering"
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary>
        {locale === "zh" ? "重試為新工作" : "Retry as new work"}
      </summary>
      <p>
        {locale === "zh"
          ? "建立新的執行，不改寫原工作。既有成功效果不會自動重送；未知效果必須先對帳。"
          : "Create a new execution, preserving the original. Confirmed effects cannot be replayed; unknown effects require reconciliation."}
      </p>
      {open && (
        <>
          {!review && !error && (
            <p role="status">
              {locale === "zh" ? "讀取效果紀錄…" : "Loading effect receipts…"}
            </p>
          )}
          {review && (
            <>
              {review.effects.length === 0 && (
                <p>
                  {locale === "zh"
                    ? "沒有已記錄的工具副作用。"
                    : "No recorded tool effects."}
                </p>
              )}
              {review.effects.map((effect) => (
                <p key={effect.id}>
                  {effect.tool} ·{" "}
                  {effect.outcome === "succeeded"
                    ? locale === "zh"
                      ? "已成功，使用既有結果"
                      : "Succeeded; use existing receipt"
                    : effect.outcome === "unknown"
                      ? locale === "zh"
                        ? "效果未知，需對帳"
                        : "Unknown; reconcile first"
                      : effect.outcome === "not_executed"
                        ? locale === "zh"
                          ? "未執行"
                          : "Not executed"
                        : locale === "zh"
                          ? "已確認無效果"
                          : "Confirmed no effect"}
                </p>
              ))}
              {unknown && (
                <p role="status">
                  {locale === "zh"
                    ? "請先在操作與對帳中確認未知效果。"
                    : "Resolve unknown effects under Operations and reconciliation first."}
                </p>
              )}
              {known.length > 100 && (
                <p role="status">
                  {locale === "zh"
                    ? "效果數量超過重試審查上限。"
                    : "Effect count exceeds retry review capacity."}
                </p>
              )}
              <label>
                <input
                  type="checkbox"
                  checked={confirmed}
                  disabled={busy || Boolean(unknown)}
                  onChange={(e) => setConfirmed(e.target.checked)}
                />
                {locale === "zh"
                  ? "已確認上述效果紀錄，建立新的工作"
                  : "I reviewed these effect receipts; create a new work"}
              </label>
              <button
                disabled={
                  !connected ||
                  !confirmed ||
                  busy ||
                  Boolean(unknown) ||
                  known.length > 100 ||
                  Boolean(created)
                }
                onClick={() => {
                  const body = {
                    runId: work.runId,
                    executionSessionId: work.executionSessionId,
                    expectedRevision: work.revision,
                    effectRefs: known.map((e) => ({
                      operationId: e.id,
                      expectedRevision: e.revision,
                      ...(e.reconciliationReceiptId
                        ? { reconciliationReceiptId: e.reconciliationReceiptId }
                        : {}),
                    })),
                  };
                  const key = JSON.stringify(body);
                  if (attempt.current?.key !== key)
                    attempt.current = { key, requestId: crypto.randomUUID() };
                  setBusy(true);
                  setError("");
                  void request(`/works/${work.id}/retry`, {
                    ...body,
                    requestId: attempt.current.requestId,
                  })
                    .then((value) => setCreated(workSchema.parse(value)))
                    .catch((e) => setError(String(e)))
                    .finally(() => setBusy(false));
                }}
              >
                {locale === "zh" ? "建立重試工作" : "Create retry work"}
              </button>
            </>
          )}
          {created && (
            <p role="status">
              {locale === "zh"
                ? "已建立新的重試工作；執行狀態由工作卡顯示。"
                : "New retry work created; its card shows execution status."}
            </p>
          )}
          {error && <p role="alert">{error}</p>}
        </>
      )}
    </details>
  );
}
