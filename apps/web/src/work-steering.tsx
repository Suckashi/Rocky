import { useEffect, useState } from "react";
import { z } from "zod";
import type {
  Work,
  PublicEvent,
} from "../../../packages/contracts/src/index.js";
import {
  steeringReceiptSchema,
  type SteeringReceipt,
} from "../../../packages/contracts/src/steering.js";
export function WorkSteering({
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
    [text, setText] = useState(""),
    [receipts, setReceipts] = useState<SteeringReceipt[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    if (!open) return;
    let live = true;
    void request(`/works/${work.id}/steering`)
      .then((value) => {
        const parsed = z
          .strictObject({ receipts: z.array(steeringReceiptSchema) })
          .parse(value);
        if (live) setReceipts(parsed.receipts);
      })
      .catch((e) => {
        if (live) setError(String(e));
      });
    return () => {
      live = false;
    };
  }, [open, work.id, work.revision, request]);
  const current = new Map(receipts.map((receipt) => [receipt.id, receipt]));
  for (const event of events)
    if (
      event.workId === work.id &&
      event.payload.kind === "domain" &&
      event.payload.name === "rocky.steering.updated"
    ) {
      const parsed = steeringReceiptSchema.safeParse(
        event.payload.data.receipt,
      );
      if (
        parsed.success &&
        (!current.has(parsed.data.id) ||
          current.get(parsed.data.id)!.status === "accepted")
      )
        current.set(parsed.data.id, parsed.data);
    }
  const active =
    work.runMode === "normal" &&
    ["running", "waiting_approval"].includes(work.status);
  const label = locale === "zh" ? "修正工作" : "Steer work";
  return (
    <details
      className="work-steering"
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary>{label}</summary>
      <p>
        {locale === "zh"
          ? "修正會等待下一個模型步驟；收件不代表已套用，也不會核准工具。需要立即停止時，請使用停止。"
          : "Corrections wait for the next model step. Receipt is not application or tool approval. Use Stop for immediate cancellation."}
      </p>
      {active && open && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!connected || busy || !text.trim()) return;
            setBusy(true);
            setError("");
            void request(`/works/${work.id}/steer`, {
              requestId: crypto.randomUUID(),
              runId: work.runId,
              executionSessionId: work.executionSessionId,
              expectedRevision: work.revision,
              text: text.trim(),
            })
              .then((value) => {
                const receipt = steeringReceiptSchema.parse(value);
                setReceipts((old) => [
                  ...old.filter((r) => r.id !== receipt.id),
                  receipt,
                ]);
                setText("");
              })
              .catch((e) => setError(String(e)))
              .finally(() => setBusy(false));
          }}
        >
          <label>
            {locale === "zh" ? "工作修正內容" : "Work correction"}
            <textarea
              maxLength={8000}
              value={text}
              onChange={(e) => setText(e.target.value)}
              disabled={!connected || busy}
            />
          </label>
          <button disabled={!connected || busy || !text.trim()}>
            {busy
              ? locale === "zh"
                ? "傳送中…"
                : "Sending…"
              : locale === "zh"
                ? "送出修正"
                : "Send correction"}
          </button>
        </form>
      )}
      {[...current.values()].map((receipt) => (
        <div key={receipt.id} className="steering-receipt">
          <small>
            {locale === "zh"
              ? {
                  accepted: "修正已收件，尚未套用",
                  applied: "修正已套用至執行脈絡",
                  not_applied: "修正未套用",
                }[receipt.status]
              : {
                  accepted: "Correction received, not yet applied",
                  applied: "Correction saved in execution context",
                  not_applied: "Correction not applied",
                }[receipt.status]}
          </small>
          <p>{receipt.text}</p>
        </div>
      ))}
      {error && <p role="alert">{error}</p>}
    </details>
  );
}
