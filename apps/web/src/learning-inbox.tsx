import { useState } from "react";
import { z } from "zod";
import {
  candidateSchema,
  type SkillCandidate,
} from "../../../packages/contracts/src/learning-candidates.js";
import { skillCandidateDraftSchema } from "../../../packages/contracts/src/reflection.js";
import {
  publicModelSchema,
  type PublicModel,
} from "../../../packages/contracts/src/models.js";
import { replacementDiff } from "../../daemon/src/write-diff.js";
const summarySchema = z.object({
  proposalId: z.uuid(),
  revision: z.number(),
  candidateRevision: z.number(),
  candidateHash: z.string(),
  name: z.string(),
  status: z.string(),
  reason: z.string().nullable(),
});
const suiteSchema = z.object({
  id: z.uuid(),
  revision: z.number(),
  hash: z.string(),
  name: z.string(),
  cases: z.number(),
});
const draftKeys = [
  "name",
  "description",
  "goal",
  "preconditions",
  "triggers",
  "steps",
  "stopConditions",
  "verification",
  "evidenceRefs",
  "requiredCapabilities",
  "knownLimitations",
] as const;
export function LearningInbox({
  locale,
  request,
}: {
  locale: "zh" | "en";
  request: (path: string, body?: unknown) => Promise<unknown>;
}) {
  const zh = locale === "zh";
  const [packageFiles, setPackageFiles] = useState<
    { path: string; text: string }[]
  >([]);
  const [baseFiles, setBaseFiles] = useState<{ path: string; text: string }[]>(
      [],
    ),
    [policyRevision, setPolicyRevision] = useState<number>(),
    [sourceSummary, setSourceSummary] = useState<unknown>();
  const [automaticHistory, setAutomaticHistory] = useState<
      Record<string, unknown>[]
    >([]),
    [automaticBefore, setAutomaticBefore] = useState<string | null>(null),
    [automaticError, setAutomaticError] = useState<string | null>(null);
  async function loadAutomatic(before?: string) {
    const page = z
      .object({
        items: z.array(z.record(z.string(), z.unknown())),
        nextBefore: z.string().nullable(),
        error: z.string().nullable(),
      })
      .parse(
        await request(
          "/learning/automation" +
            (before ? `?before=${encodeURIComponent(before)}` : ""),
        ),
      );
    setAutomaticHistory((old) =>
      before ? [...old, ...page.items] : page.items,
    );
    setAutomaticBefore(page.nextBefore);
    setAutomaticError(page.error);
  }
  const [items, setItems] = useState<
      { candidate: z.infer<typeof summarySchema>; sourceAvailable: boolean }[]
    >([]),
    [next, setNext] = useState<number | null>(null),
    [candidate, setCandidate] = useState<SkillCandidate>(),
    [draft, setDraft] = useState<z.infer<typeof skillCandidateDraftSchema>>(),
    [reason, setReason] = useState(""),
    [models, setModels] = useState<PublicModel[]>([]),
    [model, setModel] = useState("fixture"),
    [suites, setSuites] = useState<z.infer<typeof suiteSchema>[]>([]),
    [suiteId, setSuiteId] = useState(""),
    [suiteJson, setSuiteJson] = useState(""),
    [evaluation, setEvaluation] = useState<Record<string, unknown>>(),
    [history, setHistory] = useState<Record<string, unknown>[]>([]),
    [historyBefore, setHistoryBefore] = useState<number | null>(null),
    [approved, setApproved] = useState(false),
    [paidConsent, setPaidConsent] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (error) {
      setError(String(error));
    } finally {
      setBusy(false);
    }
  }
  async function load(before?: number) {
    const page = z
      .object({
        items: z.array(
          z.object({ candidate: summarySchema, sourceAvailable: z.boolean() }),
        ),
        nextBefore: z.number().nullable(),
      })
      .parse(
        await request(
          "/learning/candidates" + (before ? `?before=${before}` : ""),
        ),
      );
    setItems((old) => (before ? [...old, ...page.items] : page.items));
    setNext(page.nextBefore);
    if (!before) {
      const [rawModels, rawSuites] = await Promise.all([
        request("/model-connections"),
        request("/learning/suites"),
      ]);
      setModels(
        z.object({ connections: z.array(publicModelSchema) }).parse(rawModels)
          .connections,
      );
      setSuites(
        z.object({ suites: z.array(suiteSchema) }).parse(rawSuites).suites,
      );
    }
  }
  async function open(id: string) {
    const filesSchema = z.object({
      files: z.array(z.object({ path: z.string(), contentBase64: z.string() })),
    });
    const response = z
      .object({
        candidate: candidateSchema,
        package: filesSchema,
        basePackage: filesSchema.nullable(),
        sourceSummary: z.unknown(),
        policyRevision: z.number().int().nonnegative(),
      })
      .parse(await request(`/learning/candidates/${id}`));
    const value = response.candidate;
    setPackageFiles(
      response.package.files.map((file) => ({
        path: file.path,
        text: new TextDecoder("utf-8", { fatal: true }).decode(
          Uint8Array.from(atob(file.contentBase64), (character) =>
            character.charCodeAt(0),
          ),
        ),
      })),
    );
    setBaseFiles(
      (response.basePackage?.files ?? []).map((file) => ({
        path: file.path,
        text: new TextDecoder("utf-8", { fatal: true }).decode(
          Uint8Array.from(atob(file.contentBase64), (character) =>
            character.charCodeAt(0),
          ),
        ),
      })),
    );
    setPolicyRevision(response.policyRevision);
    setSourceSummary(response.sourceSummary);
    setCandidate(value);
    setDraft(
      skillCandidateDraftSchema.parse(
        Object.fromEntries(draftKeys.map((key) => [key, value[key]])),
      ),
    );
    setApproved(false);
    setEvaluation(undefined);
    setHistory([]);
    setHistoryBefore(null);
    if (value.evaluationId)
      setEvaluation(
        z
          .record(z.string(), z.unknown())
          .parse(await request(`/learning/evaluations/${value.evaluationId}`)),
      );
  }
  async function command(
    action: "approve" | "reject" | "withdraw" | "resubmit" | "quarantine",
  ) {
    if (!candidate) return;
    const result = candidateSchema.parse(
      await request(`/learning/candidates/${candidate.proposalId}/command`, {
        requestId: crypto.randomUUID(),
        expectedRevision: candidate.revision,
        candidateHash: candidate.candidateHash,
        action,
        ...(action === "approve"
          ? {
              evaluationId: candidate.evaluationId,
              evaluationManifestHash: evaluation?.manifestHash,
              baseRevision: candidate.base?.revision ?? null,
              policyRevision,
            }
          : {}),
      }),
    );
    setCandidate(result);
    setApproved(false);
    await load();
  }
  async function loadHistory(before?: number) {
    if (!candidate) return;
    const page = z
      .object({
        entries: z.array(z.record(z.string(), z.unknown())),
        nextBefore: z.number().nullable(),
      })
      .parse(
        await request(
          `/learning/candidates/${candidate.proposalId}/history` +
            (before ? `?before=${before}` : ""),
        ),
      );
    setHistory((old) => (before ? [...old, ...page.entries] : page.entries));
    setHistoryBefore(page.nextBefore);
  }
  return (
    <details className="model-settings">
      <summary>{zh ? "學習收件匣" : "Learning Inbox"}</summary>
      <p>
        {zh
          ? "候選須完成實際評測，再由你核准確切版本。修改後舊評測失效；測試資料不足、未知用量或不安全的執行環境都不能發布。"
          : "Candidates require actual evaluation and your approval of the exact revision. Edits invalidate earlier evaluations. Insufficient evidence, unknown usage or unsafe executors cannot pass publication."}
      </p>
      <button disabled={busy} onClick={() => void run(() => load())}>
        {zh ? "載入／重新整理" : "Load / refresh"}
      </button>
      <details>
        <summary>{zh ? "自動學習歷史" : "Automatic Learning history"}</summary>
        <button disabled={busy} onClick={() => void run(() => loadAutomatic())}>
          {zh ? "載入歷史與排程狀態" : "Load history and scheduler status"}
        </button>
        {automaticError && <p role="alert">{automaticError}</p>}
        {automaticHistory.map((entry, index) => (
          <pre key={index}>{JSON.stringify(entry, null, 2)}</pre>
        ))}
        {automaticBefore && (
          <button
            disabled={busy}
            onClick={() => void run(() => loadAutomatic(automaticBefore))}
          >
            {zh ? "更早紀錄" : "Earlier entries"}
          </button>
        )}
      </details>
      {next && (
        <button disabled={busy} onClick={() => void run(() => load(next))}>
          {zh ? "更多候選" : "More candidates"}
        </button>
      )}
      {items.map((item) => (
        <article className="model-card" key={item.candidate.proposalId}>
          <strong>{item.candidate.name}</strong>
          <p>
            r{item.candidate.candidateRevision} · {item.candidate.status} ·{" "}
            {item.candidate.candidateHash.slice(0, 16)}
          </p>
          <p>{item.candidate.reason}</p>
          <button
            disabled={busy || !item.sourceAvailable}
            onClick={() => void run(() => open(item.candidate.proposalId))}
          >
            {zh ? "審查候選" : "Review candidate"}
          </button>
        </article>
      ))}
      {candidate && draft && (
        <section
          className="model-card settings-fields"
          aria-label={zh ? "候選審查" : "Candidate review"}
        >
          <h3>
            {candidate.name} · r{candidate.candidateRevision}
          </h3>
          <p role="status">
            {candidate.status} · {candidate.reason}
          </p>
          <code>{candidate.candidateHash}</code>
          <p>
            {zh ? "來源工作" : "Source Work"}: {candidate.sourceWorkId} ·
            Episode {candidate.binding.episodeId}
          </p>
          <details>
            <summary>
              {zh ? "已同意的來源摘要" : "Consented source summary"}
            </summary>
            <pre>{JSON.stringify(sourceSummary, null, 2)}</pre>
          </details>
          <p>
            {zh ? "基底版本" : "Base revision"}:{" "}
            {candidate.base
              ? `${candidate.base.skillId} r${candidate.base.revision} ${candidate.base.contentHash}`
              : zh
                ? "新技能"
                : "New skill"}
          </p>
          <button
            disabled={busy}
            onClick={() => void run(() => open(candidate.proposalId))}
          >
            {zh ? "重新整理候選與評測" : "Refresh candidate and evaluation"}
          </button>
          <details>
            <summary>{zh ? "檔案與證據" : "Files and evidence"}</summary>
            <ul>
              {candidate.files.map((file) => (
                <li key={file.path}>
                  {file.path} · {file.sha256}
                </li>
              ))}
            </ul>
            <ul>
              {candidate.evidenceRefs.map((id) => (
                <li key={id}>{id}</li>
              ))}
            </ul>
          </details>
          <details>
            <summary>
              {zh
                ? "即將發布的完整檔案內容"
                : "Complete files proposed for publication"}
            </summary>
            {packageFiles.map((file) => (
              <section key={file.path}>
                <h4>{file.path}</h4>
                <pre
                  style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}
                >
                  {file.text}
                </pre>
              </section>
            ))}
          </details>
          <details>
            <summary>
              {zh ? "與基底版本的差異" : "Changes from base revision"}
            </summary>
            {[
              ...new Set(
                [...baseFiles, ...packageFiles].map((file) => file.path),
              ),
            ].map((path) => {
              const before =
                  baseFiles.find((file) => file.path === path)?.text ?? "",
                after =
                  packageFiles.find((file) => file.path === path)?.text ?? "",
                diff = replacementDiff(before, after);
              return before === after ? null : (
                <section key={path}>
                  <h4>{path}</h4>
                  {!diff.complete && (
                    <p>
                      {zh
                        ? "差異摘要已截斷；請查看下方基底及上方完整候選。"
                        : "Diff is truncated; inspect the complete base below and candidate above."}
                    </p>
                  )}
                  <pre
                    style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}
                  >
                    {diff.rows
                      .map(
                        (row) =>
                          `${row.kind === "add" ? "+" : row.kind === "remove" ? "-" : " "}${row.text}`,
                      )
                      .join("\n")}
                  </pre>
                  <details>
                    <summary>
                      {zh ? "完整基底檔案" : "Complete base file"}
                    </summary>
                    <pre
                      style={{
                        whiteSpace: "pre-wrap",
                        overflowWrap: "anywhere",
                      }}
                    >
                      {before}
                    </pre>
                  </details>
                </section>
              );
            })}
          </details>
          <details>
            <summary>
              {zh
                ? "編輯候選（須重新評測）"
                : "Edit candidate (requires reevaluation)"}
            </summary>
            {draftKeys.map((key) => (
              <label key={key}>
                {
                  {
                    name: "名稱 / Name",
                    description: "說明 / Description",
                    goal: "目標 / Goal",
                    preconditions: "前提 / Preconditions",
                    triggers: "觸發 / Triggers",
                    steps: "步驟 / Steps",
                    stopConditions: "停止條件 / Stop conditions",
                    verification: "驗證 / Verification",
                    evidenceRefs: "證據 ID / Evidence IDs",
                    requiredCapabilities: "所需能力（非授權）/ Capabilities",
                    knownLimitations: "限制 / Limitations",
                  }[key]
                }
                <textarea
                  disabled={busy || candidate.status === "evaluating"}
                  value={
                    Array.isArray(draft[key])
                      ? draft[key].join("\n")
                      : draft[key]
                  }
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      [key]: Array.isArray(draft[key])
                        ? event.target.value.split("\n").filter(Boolean)
                        : event.target.value,
                    })
                  }
                />
              </label>
            ))}
            <label>
              {zh ? "修改理由" : "Reason for change"}
              <textarea
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
            </label>
            <button
              disabled={
                busy || !reason.trim() || candidate.status === "evaluating"
              }
              onClick={() =>
                void run(async () => {
                  await request(
                    `/learning/candidates/${candidate.proposalId}/edit`,
                    {
                      requestId: crypto.randomUUID(),
                      expectedRevision: candidate.revision,
                      candidateHash: candidate.candidateHash,
                      draft: skillCandidateDraftSchema.parse(draft),
                      reason,
                    },
                  );
                  await open(candidate.proposalId);
                  await load();
                })
              }
            >
              {zh
                ? "保存新版本並使舊評測失效"
                : "Save revision and invalidate old evaluations"}
            </button>
          </details>
          <label>
            {zh ? "固定評測集" : "Fixed evaluation suite"}
            <select
              value={suiteId}
              onChange={(event) => setSuiteId(event.target.value)}
            >
              <option value="">{zh ? "選擇評測集" : "Select suite"}</option>
              {suites.map((suite) => (
                <option key={suite.id} value={suite.id}>
                  {suite.name} · r{suite.revision} · {suite.cases}
                </option>
              ))}
            </select>
          </label>
          <label>
            {zh ? "受測模型" : "Target model"}
            <select
              value={model}
              onChange={(event) => {
                setModel(event.target.value);
                setPaidConsent(false);
              }}
            >
              <option value="fixture">
                {zh
                  ? "合成 fixture（不能證明技能改善）"
                  : "Synthetic fixture (cannot prove skill improvement)"}
              </option>
              {models.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.config.name} · r{entry.revision}
                </option>
              ))}
            </select>
          </label>
          {model !== "fixture" && (
            <label>
              <input
                type="checkbox"
                checked={paidConsent}
                onChange={(event) => setPaidConsent(event.target.checked)}
              />
              {zh
                ? "同意使用所選模型，依固定評測集預算執行多次呼叫；未知費用不代表免費。"
                : "Authorize multiple calls to this model within the suite budget; unknown cost does not mean free."}
            </label>
          )}
          <button
            disabled={
              busy ||
              !suiteId ||
              (model !== "fixture" && !paidConsent) ||
              candidate.status === "evaluating"
            }
            onClick={() =>
              void run(async () => {
                const suite = suites.find((item) => item.id === suiteId),
                  selected = models.find((item) => item.id === model);
                if (!suite || (model !== "fixture" && !selected))
                  throw Error(
                    "Selected suite or model is no longer available; refresh before evaluating",
                  );
                await request(
                  `/learning/candidates/${candidate.proposalId}/evaluate`,
                  {
                    requestId: crypto.randomUUID(),
                    expectedRevision: candidate.revision,
                    candidateHash: candidate.candidateHash,
                    suiteId: suite.id,
                    suiteRevision: suite.revision,
                    suiteHash: suite.hash,
                    target: selected
                      ? {
                          mode: "configured",
                          modelSelection: {
                            connectionId: selected.id,
                            revision: selected.revision,
                          },
                        }
                      : { mode: "fixture" },
                  },
                );
                await open(candidate.proposalId);
              })
            }
          >
            {zh ? "執行評測／重試" : "Evaluate / retry"}
          </button>
          {candidate.status === "evaluating" && candidate.evaluationId && (
            <button
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await request(
                    `/learning/evaluations/${candidate.evaluationId}/stop`,
                    {},
                  );
                  await open(candidate.proposalId);
                })
              }
            >
              {zh ? "停止評測" : "Stop evaluation"}
            </button>
          )}
          {evaluation && (
            <details>
              <summary>
                {zh
                  ? "真實評測結果與 manifest"
                  : "Actual evaluation and manifest"}
              </summary>
              <pre>{JSON.stringify(evaluation, null, 2)}</pre>
            </details>
          )}
          <label>
            <input
              type="checkbox"
              checked={approved}
              onChange={(event) => setApproved(event.target.checked)}
              disabled={candidate.status !== "needs_review"}
            />
            {zh
              ? "我已審查以上候選 hash、基底與評測；核准這個確切版本。"
              : "I reviewed this candidate hash, base and evaluation; approve this exact revision."}
          </label>
          <button
            disabled={busy || !approved || candidate.status !== "needs_review"}
            onClick={() => void run(() => command("approve"))}
          >
            {zh ? "發布確切版本" : "Publish exact revision"}
          </button>
          {(["reject", "withdraw", "resubmit", "quarantine"] as const).map(
            (action) => (
              <button
                key={action}
                disabled={
                  busy ||
                  candidate.status === "evaluating" ||
                  ["published", "withdrawn", "quarantined"].includes(
                    candidate.status,
                  )
                }
                onClick={() => void run(() => command(action))}
              >
                {
                  {
                    reject: zh ? "拒絕" : "Reject",
                    withdraw: zh ? "撤回" : "Withdraw",
                    resubmit: zh ? "重新提交草稿" : "Resubmit draft",
                    quarantine: zh ? "隔離" : "Quarantine",
                  }[action]
                }
              </button>
            ),
          )}
          <button disabled={busy} onClick={() => void run(() => loadHistory())}>
            {zh ? "操作歷史" : "History"}
          </button>
          {history.map((entry, index) => (
            <pre key={index}>{JSON.stringify(entry)}</pre>
          ))}
          {historyBefore && (
            <button
              disabled={busy}
              onClick={() => void run(() => loadHistory(historyBefore))}
            >
              {zh ? "更早歷史" : "Earlier history"}
            </button>
          )}
          {candidate.published && (
            <p>
              {zh
                ? "已發布至 Skills，可在技能設定比較、回滾與隔離。"
                : "Published to Skills. Compare, roll back or quarantine in skill settings."}{" "}
              {candidate.published.skillId} r{candidate.published.skillRevision}
            </p>
          )}
        </section>
      )}
      <details>
        <summary>
          {zh
            ? "匯入版本化評測集（owner）"
            : "Import versioned evaluation suite (owner)"}
        </summary>
        <p>
          {zh
            ? "只接受資料型 JSON，不執行 provider、腳本或自訂評分程式。必須先定義案例分割、期望結果、改善指標與資源上限。"
            : "Data-only JSON; no provider, scripts or custom grading code. Define splits, expected results, improvement metric and budgets before testing."}
        </p>
        <textarea
          value={suiteJson}
          onChange={(event) => setSuiteJson(event.target.value)}
          aria-label={zh ? "評測集 JSON" : "Evaluation suite JSON"}
        />
        <button
          disabled={busy || !suiteJson.trim()}
          onClick={() =>
            void run(async () => {
              await request("/learning/suites", {
                ...JSON.parse(suiteJson),
                requestId: crypto.randomUUID(),
              });
              await load();
            })
          }
        >
          {zh ? "保存評測集" : "Save suite"}
        </button>
      </details>
      {busy && <p role="status">{zh ? "處理中…" : "Working…"}</p>}
      {error && <p role="alert">{error}</p>}
    </details>
  );
}
