import { useEffect, useRef, useState } from "react";
import { z } from "zod";
const schema = z.object({
  items: z.array(
    z.object({
      id: z.uuid(),
      workId: z.uuid(),
      createdAt: z.string(),
      status: z.literal("pending_review"),
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
            {zh ? "待審查" : "Pending review"} · {item.createdAt}
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
