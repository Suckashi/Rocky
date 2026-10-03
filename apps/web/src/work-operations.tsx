import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import {
  operationSummarySchema,
  reconciliationReceiptSchema,
} from "../../../packages/contracts/src/operations.js";
const listSchema = z.strictObject({
  operations: z.array(operationSummarySchema),
});
type Operation = z.infer<typeof operationSummarySchema>;
export function WorkOperations({
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
  const [open, setOpen] = useState(false),
    [operations, setOperations] = useState<Operation[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(false),
    [refresh, setRefresh] = useState(0),
    [message, setMessage] = useState("");
  const commands = useRef(new Map<string, string>());
  const zh = locale === "zh";
  useEffect(() => {
    if (!open) return;
    let active = true;
    setLoading(true);
    void request(`/works/${workId}/operations`)
      .then((value) => {
        const data = listSchema.parse(value);
        if (active) {
          setOperations(data.operations);
          setError("");
        }
      })
      .catch((e) => {
        if (active) setError(String(e));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [open, workId, revision, refresh, request]);
  async function reconcile(operation: Operation) {
    setBusy(true);
    setError("");
    setMessage("");
    const key = operation.id + ":" + operation.revision;
    const requestId = commands.current.get(key) ?? crypto.randomUUID();
    commands.current.set(key, requestId);
    try {
      const receipt = reconciliationReceiptSchema.parse(
        await request(`/works/${workId}/reconcile`, {
          requestId,
          operationId: operation.id,
          expectedRevision: operation.revision,
        }),
      );
      commands.current.delete(key);
      setMessage(
        receipt.outcome === "unknown"
          ? zh
            ? "仍無法確認結果；操作不會重送。"
            : "The result is still unknown. The operation will not be resent."
          : zh
            ? "結果已確認；此工作不會自動重新執行。"
            : "Result confirmed. This work will not restart automatically.",
      );
      setRefresh((value) => value + 1);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  const outcome = (operation: Operation) => {
    if (operation.outcome === "unknown")
      return zh ? "結果未確認" : "Result unknown";
    if (operation.outcome === "succeeded") return zh ? "已成功" : "Succeeded";
    if (operation.outcome === "failed_known_no_effect")
      return zh ? "未產生效果" : "No effect confirmed";
    return zh ? "尚未送出" : "Not dispatched";
  };
  return (
    <details
      className="work-operations"
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary>{zh ? "操作與對帳" : "Operations and reconciliation"}</summary>
      <p>
        {zh
          ? "查詢既有操作的收據，不會再次執行工具。查無收據時仍保留未確認狀態。"
          : "Query existing operation receipts without running tools again. Missing receipts leave the result unknown."}
      </p>
      {error && <p role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}
      {loading && <p>{zh ? "載入中…" : "Loading…"}</p>}
      {!loading && !error && !operations.length && (
        <p>{zh ? "尚無操作紀錄" : "No operations yet"}</p>
      )}
      <ul>
        {operations.map((operation) => (
          <li key={operation.id}>
            <strong>{operation.tool}</strong>
            {" — "}
            <span>{outcome(operation)}</span>{" "}
            {operation.canReconcile ? (
              <button
                type="button"
                disabled={busy || loading}
                onClick={() => void reconcile(operation)}
              >
                {zh ? "查詢結果" : "Check result"}
              </button>
            ) : operation.outcome === "unknown" ? (
              <p>
                {zh
                  ? "此工具尚無可用的對帳查詢，需先確認外部結果。"
                  : "No status query is available for this tool. Its external result needs review."}
              </p>
            ) : null}
          </li>
        ))}
      </ul>
    </details>
  );
}
