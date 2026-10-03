import { useEffect, useRef, useState } from "react";
import { z } from "zod";
const schema = z.object({
  items: z.array(
    z.object({
      id: z.uuid(),
      revision: z.number(),
      contentHash: z.string(),
      workId: z.uuid(),
      createdAt: z.string(),
      status: z.enum([
        "pending_review",
        "needs_review",
        "approved",
        "rejected",
      ]),
      summary: z.object({
        goal: z.string(),
        constraints: z.array(z.string()),
        corrections: z.array(z.string()),
        verification: z.array(z.string()),
        failuresAndRepairs: z.array(z.string()),
        preconditions: z.array(z.string()),
      }),
      evidence: z.array(
        z.object({ id: z.string(), sequence: z.string(), name: z.string() }),
      ),
    }),
  ),
  nextCursor: z.string().nullable(),
});
export function LearningEpisodes({
  locale,
  request,
}: {
  locale: "zh" | "en";
  request: (path: string, body?: unknown) => Promise<unknown>;
}) {
  const zh = locale === "zh",
    alive = useRef(true);
  const intent = useRef({ key: "", id: "" });
  const [ack, setAck] = useState<string[]>([]);
  const [value, setValue] = useState<z.infer<typeof schema>>(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  async function load(before?: string) {
    setBusy(true);
    setError("");
    setValue(undefined);
    setAck([]);
    try {
      const result = schema.parse(
        await request(
          "/learning/episodes" +
            (before ? "?before=" + encodeURIComponent(before) : ""),
        ),
      );
      if (alive.current) setValue(result);
    } catch (e) {
      if (alive.current) setError(String(e));
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  async function decide(
    item: z.infer<typeof schema>["items"][number],
    decision: "approve" | "reject",
  ) {
    setBusy(true);
    setError("");
    try {
      const body = {
          expectedRevision: item.revision,
          contentHash: item.contentHash,
          decision,
        },
        key = JSON.stringify([item.id, body]);
      if (intent.current.key !== key)
        intent.current = { key, id: crypto.randomUUID() };
      await request(`/learning/episodes/${item.id}/review`, {
        ...body,
        requestId: intent.current.id,
      });
      if (alive.current) await load();
    } catch (e) {
      if (alive.current) setError(String(e));
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  return (
    <details className="learning-episodes">
      <summary>
        {zh ? "待審查學習摘要" : "Learning summaries for review"}
      </summary>
      <p>
        {zh
          ? "摘要由使用者提供，尚未獨立驗證。查看內容不會開始反思、評測或發布。"
          : "Summaries are owner-provided and not independently verified. Viewing does not start reflection, evaluation or publication."}
      </p>
      <button disabled={busy} onClick={() => void load()}>
        {zh ? "載入／重新整理摘要" : "Load / refresh summaries"}
      </button>
      {error && <p role="alert">{error}</p>}
      {value && !value.items.length && (
        <p role="status">
          {zh
            ? "本頁沒有可讀取的摘要。"
            : "No accessible summaries on this page."}
        </p>
      )}
      {value?.items.map((item) => (
        <article key={item.id} className="model-card">
          <strong>{item.summary.goal}</strong>
          <p>
            {item.status === "needs_review"
              ? zh
                ? "內容已變更，需要重新審查"
                : "Content changed; review required again"
              : item.status === "approved"
                ? zh
                  ? "已核准摘要，尚未反思"
                  : "Summary approved, reflection not started"
                : item.status === "rejected"
                  ? zh
                    ? "已拒絕"
                    : "Rejected"
                  : zh
                    ? "待審查"
                    : "Pending review"}{" "}
            · {item.createdAt}
          </p>
          <details>
            <summary>{zh ? "檢視摘要內容" : "View summary"}</summary>
            {(
              [
                ["constraints", zh ? "限制" : "Constraints"],
                ["corrections", zh ? "使用者修正" : "User corrections"],
                [
                  "verification",
                  zh
                    ? "驗證結果（未獨立驗證）"
                    : "Verification (not independently verified)",
                ],
                [
                  "failuresAndRepairs",
                  zh ? "失敗與修復" : "Failures and repairs",
                ],
                ["preconditions", zh ? "適用前提" : "Preconditions"],
              ] as const
            ).map(([key, label]) => (
              <div key={key}>
                <strong>{label}</strong>
                <p className="memory-content">
                  {item.summary[key].join("\n") || "—"}
                </p>
              </div>
            ))}
            <details>
              <summary>
                {zh ? "來源證據識別" : "Source evidence identifiers"}
              </summary>
              <p>
                {zh ? "來源工作" : "Source work"}: <code>{item.workId}</code>
              </p>
              <p>
                {zh ? "摘要" : "Episode"}: <code>{item.id}</code>
              </p>
              {item.evidence.map((event) => (
                <p key={event.id}>
                  <code>{event.name}</code> · {event.sequence}
                  <br />
                  <code>{event.id}</code>
                </p>
              ))}
            </details>
            {["pending_review", "needs_review"].includes(item.status) && (
              <>
                <p>
                  {zh
                    ? "核准僅允許此摘要供後續反思使用，不代表驗證成功或授權發布技能。"
                    : "Approval permits this summary for future reflection only, not a verified outcome or skill publication."}
                </p>
                <label>
                  <input
                    type="checkbox"
                    disabled={busy}
                    checked={ack.includes(item.id)}
                    onChange={(e) =>
                      setAck((old) =>
                        e.target.checked
                          ? [...old, item.id]
                          : old.filter((id) => id !== item.id),
                      )
                    }
                  />
                  {zh
                    ? "我已審查這份摘要及來源"
                    : "I reviewed this summary and its sources"}
                </label>
                <div className="actions">
                  <button
                    disabled={busy || !ack.includes(item.id)}
                    onClick={() => void decide(item, "approve")}
                  >
                    {zh ? "核准這份摘要" : "Approve this summary"}
                  </button>
                  <button
                    disabled={busy}
                    onClick={() => void decide(item, "reject")}
                  >
                    {zh ? "拒絕這份摘要" : "Reject this summary"}
                  </button>
                </div>
              </>
            )}
          </details>
        </article>
      ))}
      {value?.nextCursor && (
        <button disabled={busy} onClick={() => void load(value.nextCursor!)}>
          {zh ? "較早的摘要" : "Earlier summaries"}
        </button>
      )}
    </details>
  );
}
