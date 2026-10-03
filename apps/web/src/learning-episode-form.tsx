import { useEffect, useRef, useState, type FormEvent } from "react";
import { z } from "zod";
import type {
  Work,
  PublicEvent,
} from "../../../packages/contracts/src/index.js";
import {
  learningPolicySchema,
  learningEpisodeCommandSchema,
} from "../../../packages/contracts/src/learning.js";
const fields = [
  "goal",
  "constraints",
  "corrections",
  "verification",
  "failuresAndRepairs",
  "preconditions",
] as const;
const labels = {
  zh: [
    "可重用的目標",
    "限制（每行一項）",
    "使用者修正（每行一項）",
    "驗證結果（每行一項）",
    "失敗與修復（每行一項）",
    "適用前提（每行一項）",
  ],
  en: [
    "Reusable goal",
    "Constraints (one per line)",
    "User corrections (one per line)",
    "Verification results (one per line)",
    "Failures and repairs (one per line)",
    "Preconditions (one per line)",
  ],
};
export function LearningEpisodeForm({
  work,
  events,
  consentRevision,
  locale,
  request,
}: {
  work: Work;
  events: PublicEvent[];
  consentRevision: number;
  locale: "zh" | "en";
  request: (path: string, body?: unknown) => Promise<unknown>;
}) {
  const zh = locale === "zh",
    alive = useRef(true),
    intent = useRef<{ key: string; body: unknown } | undefined>(undefined);
  const [draft, setDraft] = useState<Record<(typeof fields)[number], string>>({
      goal: "",
      constraints: "",
      corrections: "",
      verification: "",
      failuresAndRepairs: "",
      preconditions: "",
    }),
    [selected, setSelected] = useState<string[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [saved, setSaved] = useState<{
      id: string;
      summary: Record<string, unknown>;
    }>();
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const evidence = events.filter(
    (e) =>
      e.workId === work.id &&
      e.runId === work.runId &&
      e.payload.kind === "domain" &&
      [
        "rocky.tool.completed",
        "rocky.tool.failed",
        "rocky.operation.succeeded",
        "rocky.operation.failed_no_effect",
        "rocky.artifact.published",
        "rocky.steering.updated",
      ].includes(e.payload.name),
  );
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const key = JSON.stringify([work.id, consentRevision, draft, selected]);
      if (intent.current?.key !== key) {
        const policy = learningPolicySchema.parse(
          await request("/learning/policy"),
        );
        const content = Object.fromEntries(
          fields.map((field) => [
            field,
            field === "goal"
              ? draft[field]
              : draft[field]
                  .split(/\r?\n/)
                  .map((line) => line.trim())
                  .filter(Boolean),
          ]),
        );
        intent.current = {
          key,
          body: learningEpisodeCommandSchema.parse({
            ...content,
            requestId: crypto.randomUUID(),
            workId: work.id,
            expectedPolicyRevision: policy.revision,
            expectedConsentRevision: consentRevision,
            trigger: "manual_request",
            evidenceEventIds: selected,
          }),
        };
      }
      const result = z
        .object({
          id: z.uuid(),
          status: z.literal("pending_review"),
          summary: z.record(z.string(), z.unknown()),
        })
        .parse(await request("/learning/episodes", intent.current.body));
      if (alive.current) setSaved(result);
    } catch (e) {
      if (alive.current) {
        setError(String(e));
      }
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  return (
    <details className="learning-episode-form">
      <summary>
        {zh ? "從此工作建立學習摘要" : "Create Learning summary from this work"}
      </summary>
      <p>
        {zh
          ? "僅儲存你選取的事件引用與以下摘要。工具事件不等於成功證明；摘要尚未獨立驗證，也不會直接發布技能。"
          : "Only selected event references and this summary are saved. Tool events do not prove success; the summary is not independently verified and does not publish a skill."}
      </p>
      {saved ? (
        <section>
          <p role="status">
            {zh
              ? "摘要已保存，待審查；反思尚未啟動。"
              : "Summary saved, pending review; reflection has not started."}
          </p>
          {fields.map((field, i) => (
            <div key={field}>
              <strong>{labels[locale][i]}</strong>
              <p className="memory-content">
                {Array.isArray(saved.summary[field])
                  ? (saved.summary[field] as string[]).join("\n")
                  : String(saved.summary[field] ?? "")}
              </p>
            </div>
          ))}
          <details>
            <summary>{zh ? "紀錄識別碼" : "Record ID"}</summary>
            <code>{saved.id}</code>
          </details>
        </section>
      ) : (
        <form onSubmit={(e) => void submit(e)}>
          <fieldset disabled={busy} className="model-card">
            {fields.map((field, i) => (
              <label key={field}>
                {labels[locale][i]}
                <textarea
                  required={field === "goal"}
                  maxLength={field === "goal" ? 2000 : 20000}
                  value={draft[field]}
                  onChange={(e) => {
                    setDraft((old) => ({ ...old, [field]: e.target.value }));
                    intent.current = undefined;
                  }}
                />
              </label>
            ))}
            <fieldset>
              <legend>
                {zh ? "選取已觀察到的證據" : "Select observed evidence"}
              </legend>
              {!evidence.length && (
                <p>
                  {zh
                    ? "目前載入的工作記錄沒有可選事件。"
                    : "No selectable events in the currently loaded work record."}
                </p>
              )}
              {evidence.map((event) => (
                <label key={event.id}>
                  <input
                    type="checkbox"
                    checked={selected.includes(event.id)}
                    onChange={(e) => {
                      setSelected((old) =>
                        e.target.checked
                          ? [...old, event.id]
                          : old.filter((id) => id !== event.id),
                      );
                      intent.current = undefined;
                    }}
                  />
                  {event.payload.kind === "domain"
                    ? `${({ "rocky.tool.completed": zh ? "工具完成" : "Tool completed", "rocky.tool.failed": zh ? "工具失敗" : "Tool failed", "rocky.operation.succeeded": zh ? "操作成功" : "Operation succeeded", "rocky.operation.failed_no_effect": zh ? "操作失敗，未產生效果" : "Operation failed without effect", "rocky.artifact.published": zh ? "成果已保存" : "Artifact saved", "rocky.steering.updated": zh ? "工作修正" : "Work correction" } as Record<string, string>)[event.payload.name]} · ${String(event.payload.data.name ?? "")}`
                    : ""}{" "}
                </label>
              ))}
            </fieldset>
            {error && <p role="alert">{error}</p>}
            <button
              disabled={
                !draft.goal.trim() || !selected.length || selected.length > 30
              }
            >
              {zh ? "保存待審查摘要" : "Save summary for review"}
            </button>
          </fieldset>
        </form>
      )}
    </details>
  );
}
