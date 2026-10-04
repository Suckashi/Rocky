import { useEffect, useState } from "react";
import type { Work } from "../../../packages/contracts/src/index.js";

type Receipt = {
  id: string;
  workId: string;
  runId: string;
  executionSessionId: string;
  phase: string;
  outcome: string;
  reason: string | null;
  command: { executable: string; args: string[]; cwd: string } | null;
  result: {
    reason: string;
    exitCode: number | null;
    stdout: string;
    stderr: string;
    outputTruncated: boolean;
  } | null;
};

export function CommandTerminal({
  work,
  cursor,
  locale,
  request,
}: {
  work: Work | undefined;
  cursor: string;
  locale: "zh" | "en";
  request: (path: string, body?: unknown) => Promise<unknown>;
}) {
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const zh = locale === "zh";
  const workId = work?.id;
  useEffect(() => {
    let current = true;
    setReceipts([]);
    setError("");
    setLoading(!!workId);
    if (workId)
      void request(`/works/${workId}/commands`)
        .then((value) => {
          if (current) setReceipts((value as { commands: Receipt[] }).commands);
        })
        .catch((cause: unknown) => {
          if (current)
            setError(cause instanceof Error ? cause.message : String(cause));
        })
        .finally(() => {
          if (current) setLoading(false);
        });
    return () => {
      current = false;
    };
  }, [workId, cursor, request]);
  return (
    <div className="computer-setup">
      <h3>Terminal</h3>
      {work?.environmentId && (
        <p>
          {zh ? "此 Work 選定隔離環境：" : "Selected isolated environment: "}
          {work.environmentId}
        </p>
      )}
      <p>
        {zh
          ? "本機命令使用 OS 權限，沒有 sandbox。以下為 daemon 保存的命令收據；exit 0 不代表外部效果已驗證。"
          : "Native commands use OS permissions without a sandbox. These are persisted daemon receipts; exit 0 does not verify external effects."}
      </p>
      {error && <p role="alert">{error}</p>}
      {loading && (
        <p role="status">
          {zh ? "載入命令收據…" : "Loading command receipts…"}
        </p>
      )}
      {!loading && !error && !receipts.length && (
        <p>
          {zh
            ? "此工作尚無命令收據。請在對話提出工作並審查精確命令核准。"
            : "No command receipts for this Work. Request work in chat and review the exact command approval."}
        </p>
      )}
      {receipts
        .filter(
          (r) =>
            r.workId === work?.id &&
            r.runId === work.runId &&
            r.executionSessionId === work.executionSessionId,
        )
        .map((receipt) => (
          <article key={receipt.id}>
            <strong>
              {receipt.phase} · {receipt.outcome}
            </strong>
            {receipt.command && (
              <>
                <p>{receipt.command.cwd}</p>
                <pre>
                  {receipt.command.executable}
                  {"\n"}
                  {JSON.stringify(receipt.command.args, null, 2)}
                </pre>
              </>
            )}
            {receipt.reason && (
              <p>
                {(
                  {
                    owner_rejected: zh
                      ? "已拒絕，沒有執行。"
                      : "Rejected; not executed.",
                    steering_superseded: zh
                      ? "已由補充指令取代，舊核准已過期。"
                      : "Superseded by steering; previous approval expired.",
                    stopped: zh
                      ? "已取消，沒有執行。"
                      : "Cancelled; not executed.",
                    restarted: zh
                      ? "重啟前尚未執行；不會自動重播。"
                      : "Not executed before restart; not automatically replayed.",
                  } as Record<string, string>
                )[receipt.reason] ?? receipt.reason}
              </p>
            )}
            {receipt.outcome === "unknown" && (
              <p role="status">
                {zh
                  ? "效果未知，必須先對帳；不可自動重試。"
                  : "Effects unknown. Reconcile before retrying."}
              </p>
            )}
            {receipt.outcome === "not_executed" && (
              <p>
                {zh
                  ? "尚未執行；可能待核准、已拒絕或已取消。"
                  : "Not executed: pending approval, rejected, or cancelled."}
              </p>
            )}
            {receipt.result && (
              <>
                <p>
                  {receipt.result.reason} · exit{" "}
                  {receipt.result.exitCode ?? "—"}
                </p>
                <pre aria-label="stdout">{receipt.result.stdout}</pre>
                <pre aria-label="stderr">{receipt.result.stderr}</pre>
                {receipt.result.outputTruncated && (
                  <p>
                    {zh
                      ? "輸出已達上限並截斷。"
                      : "Output limit reached; output truncated."}
                  </p>
                )}
              </>
            )}
            <details>
              <summary>
                {zh ? "工作與操作識別" : "Work and operation identity"}
              </summary>
              <pre>
                {JSON.stringify(
                  {
                    workId: receipt.workId,
                    runId: receipt.runId,
                    operationId: receipt.id,
                  },
                  null,
                  2,
                )}
              </pre>
            </details>
          </article>
        ))}
    </div>
  );
}
