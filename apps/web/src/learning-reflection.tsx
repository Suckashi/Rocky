import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import {
  workSchema,
  type Work,
} from "../../../packages/contracts/src/index.js";
import {
  publicModelSchema,
  type PublicModel,
} from "../../../packages/contracts/src/models.js";
const resultsSchema = z.object({
  status: z.string(),
  outputs: z.array(
    z.object({
      id: z.string(),
      kind: z.string(),
      status: z.string(),
      payload: z.record(z.string(), z.unknown()),
    }),
  ),
  nextCursor: z.string().nullable(),
});
export function LearningReflection({
  locale,
  episode,
  request,
}: {
  locale: "zh" | "en";
  episode: { id: string; revision: number; contentHash: string };
  request: (path: string, body?: unknown) => Promise<unknown>;
}) {
  const zh = locale === "zh",
    alive = useRef(true),
    intent = useRef({ key: "", id: "" });
  const [models, setModels] = useState<PublicModel[]>([]),
    [model, setModel] = useState(""),
    [calls, setCalls] = useState(12),
    [work, setWork] = useState<Work>(),
    [results, setResults] = useState<z.infer<typeof resultsSchema>>(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (e) {
      if (alive.current) setError(String(e));
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  async function refresh(target: Work, before?: string) {
    setResults(undefined);
    const current = workSchema.parse(await request(`/works/${target.id}`));
    if (alive.current) setWork(current);
    const next = resultsSchema.parse(
      await request(
        `/learning/reflections/${target.id}/results` +
          (before ? "?before=" + encodeURIComponent(before) : ""),
      ),
    );
    if (alive.current) setResults(next);
  }
  async function load() {
    const [raw, list] = await Promise.all([
      request("/model-connections"),
      request("/works"),
    ]);
    const available = z
      .object({ connections: z.array(publicModelSchema) })
      .parse(raw).connections;
    const history = z
      .object({ works: z.array(workSchema) })
      .parse(list)
      .works.filter((w) => w.reflection?.episodeId === episode.id);
    if (!alive.current) return;
    setModels(available);
    const latest = history.at(-1);
    if (latest) await refresh(latest);
  }
  async function start() {
    const selected = models.find((m) => m.id === model);
    if (!selected) return;
    const body = {
      binding: {
        episodeId: episode.id,
        episodeRevision: episode.revision,
        episodeHash: episode.contentHash,
      },
      modelSelection: {
        connectionId: selected.id,
        revision: selected.revision,
      },
      modelBudget: { maxCalls: calls },
    };
    const key = JSON.stringify(body);
    if (intent.current.key !== key)
      intent.current = { key, id: crypto.randomUUID() };
    const created = workSchema.parse(
      await request("/learning/reflections", {
        ...body,
        requestId: intent.current.id,
      }),
    );
    if (alive.current) {
      setWork(created);
      setResults(undefined);
    }
  }
  const active =
    work && ["queued", "running", "waiting_approval"].includes(work.status);
  return (
    <details className="learning-reflection">
      <summary>
        {zh ? "手動反思與結果" : "Manual reflection and results"}
      </summary>
      <p>
        {zh
          ? "只產生未評測候選或無可學習結果，不會發布技能。狀態需手動重新整理；亦可在工作清單查看。"
          : "Produces unevaluated drafts or no-learning results, never publishes skills. Refresh status manually or inspect the Work list."}
      </p>
      <div className="actions">
        <button disabled={busy} onClick={() => void run(load)}>
          {zh ? "載入模型與最近反思" : "Load models and latest reflection"}
        </button>
      </div>
      <label>
        {zh ? "反思模型" : "Reflection model"}
        <select
          value={model}
          disabled={busy || Boolean(active)}
          onChange={(e) => setModel(e.target.value)}
        >
          <option value="">
            {zh ? "選擇已設定模型" : "Choose configured model"}
          </option>
          {models.map((m) => (
            <option key={m.id} value={m.id}>
              {m.config.name} · {m.config.modelId}
            </option>
          ))}
        </select>
      </label>
      <label>
        {zh ? "模型呼叫上限" : "Maximum model calls"}
        <input
          type="number"
          min={1}
          max={10000}
          value={calls}
          disabled={busy || Boolean(active)}
          onChange={(e) => setCalls(Number(e.target.value))}
        />
      </label>
      <button
        disabled={
          busy ||
          !model ||
          Boolean(work) ||
          !Number.isInteger(calls) ||
          calls < 1 ||
          calls > 10000
        }
        onClick={() => void run(start)}
      >
        {zh ? "啟動受限反思" : "Start restricted reflection"}
      </button>
      {work && (
        <>
          <p role="status">
            {zh ? "反思工作" : "Reflection Work"}:{" "}
            {
              {
                queued: zh ? "排隊中" : "Queued",
                interrupted: zh ? "已中斷" : "Interrupted",
                running: zh ? "執行中" : "Running",
                completed: zh ? "已完成" : "Completed",
                failed: zh ? "失敗" : "Failed",
                cancelled: zh ? "已取消" : "Cancelled",
                blocked: zh ? "受阻" : "Blocked",
                waiting_approval: zh ? "等待核准" : "Awaiting approval",
              }[work.status]
            }
          </p>
          {work.error && <p role="alert">{work.error}</p>}
          <div className="actions">
            <button
              disabled={busy}
              onClick={() => void run(() => refresh(work))}
            >
              {zh ? "重新整理反思結果" : "Refresh reflection results"}
            </button>
            {active && (
              <button
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const stopped = workSchema.parse(
                      await request(`/works/${work.id}/stop`, {
                        requestId: crypto.randomUUID(),
                        runId: work.runId,
                        executionSessionId: work.executionSessionId,
                        expectedRevision: work.revision,
                      }),
                    );
                    if (alive.current) setWork(stopped);
                  })
                }
              >
                {zh ? "停止反思" : "Stop reflection"}
              </button>
            )}
          </div>
          <details>
            <summary>{zh ? "執行識別" : "Execution identifiers"}</summary>
            <code>{work.id}</code>
          </details>
        </>
      )}
      {error && <p role="alert">{error}</p>}
      {results?.outputs.map((output) => (
        <section className="model-card" key={output.id}>
          <strong>
            {output.kind === "mark_no_learning"
              ? zh
                ? "沒有可重用的結論"
                : "No reusable conclusion"
              : zh
                ? "未評測技能候選"
                : "Unevaluated skill draft"}
          </strong>
          <p className="memory-content">
            {typeof output.payload.reason === "string"
              ? output.payload.reason
              : zh
                ? "候選已保存，評測與發布流程尚未完成。"
                : "Draft saved; evaluation and publication pipeline remains unfinished."}
          </p>
          <details>
            <summary>
              {zh ? "候選資料與證據" : "Draft data and evidence"}
            </summary>
            <pre>{JSON.stringify(output.payload, null, 2)}</pre>
          </details>
        </section>
      ))}
      {results && !results.outputs.length && (
        <p>
          {zh ? "本頁尚無持久化結果。" : "No persisted results on this page."}
        </p>
      )}
      {results?.nextCursor && work && (
        <button
          disabled={busy}
          onClick={() => void run(() => refresh(work, results.nextCursor!))}
        >
          {zh ? "較早的結果" : "Earlier results"}
        </button>
      )}
    </details>
  );
}
