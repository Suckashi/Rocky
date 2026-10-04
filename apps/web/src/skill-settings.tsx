import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { SkillDiscovery } from "./skill-discovery.js";
import { SkillImport } from "./skill-import.js";
import { SkillDiff } from "./skill-diff.js";

const revisionSchema = z.object({
  id: z.uuid(),
  revision: z.number().int(),
  contentHash: z.string(),
  metadata: z.object({ name: z.string(), description: z.string() }),
  scope: z.object({
    kind: z.enum(["user", "project"]),
    projectId: z.string().optional(),
  }),
  source: z.object({
    type: z.string(),
    reference: z.string(),
    license: z.string(),
  }),
  files: z.array(
    z.object({ path: z.string(), bytes: z.number(), sha256: z.string() }),
  ),
});
const selectionSchema = z.object({
  id: z.uuid(),
  revision: z.number().int(),
  skillRevision: z.number().int(),
  contentHash: z.string(),
  state: z.enum(["published", "inactive", "quarantined"]),
});
type Revision = z.infer<typeof revisionSchema>;
type Selection = z.infer<typeof selectionSchema>;
function previewText(base64: string): string | null {
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(
      Uint8Array.from(atob(base64), (c) => c.charCodeAt(0)),
    );
    return text.includes("\0") ? null : text;
  } catch {
    return null;
  }
}
export function SkillSettings({
  locale,
  request,
}: {
  locale: "zh" | "en";
  request: (path: string, body?: unknown) => Promise<unknown>;
}) {
  const zh = locale === "zh";
  const [items, setItems] = useState<Revision[]>([]),
    [loaded, setLoaded] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [review, setReview] = useState<{
    revision: Revision;
    selection: Selection | null;
    content: string | null;
    files: { path: string; contentBase64: string }[];
    path: string;
  }>();
  const [trusted, setTrusted] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [history, setHistory] = useState<{
    id: string;
    revisions: Revision[];
    nextBefore: number | null;
  }>();
  const [selectionLog, setSelectionLog] = useState<{
    id: string;
    entries: { sequence: number; selection: Selection }[];
    nextBefore: number | null;
  }>();
  const [updating, setUpdating] = useState<Revision>();
  const epoch = useRef(0),
    intent = useRef({ key: "", requestId: "" });
  useEffect(
    () => () => {
      epoch.current++;
    },
    [],
  );
  async function refresh(after?: string) {
    const generation = ++epoch.current;
    setBusy(true);
    setError("");
    setReview(undefined);
    setTrusted(false);
    try {
      const result = z
        .object({
          skills: z.array(revisionSchema),
          nextCursor: z.string().nullable().optional(),
        })
        .parse(await request("/skills" + (after ? "?after=" + after : "")));
      if (generation === epoch.current) {
        setItems((old) => (after ? [...old, ...result.skills] : result.skills));
        setNextCursor(result.nextCursor ?? null);
        setLoaded(true);
      }
    } catch (e) {
      if (generation === epoch.current) setError(String(e));
    } finally {
      if (generation === epoch.current) setBusy(false);
    }
  }
  async function open(item: Revision, version = item.revision) {
    const generation = ++epoch.current;
    setBusy(true);
    setError("");
    setReview(undefined);
    setTrusted(false);
    try {
      const [raw, selected] = await Promise.all([
        request(`/skills/${item.id}/revisions/${version}`),
        request(`/skills/${item.id}/selection`),
      ]);
      const detail = z
        .object({
          revision: revisionSchema,
          package: z.object({
            files: z.array(
              z.object({ path: z.string(), contentBase64: z.string() }),
            ),
          }),
        })
        .parse(raw);
      const selection = z
        .object({ selection: selectionSchema.nullable() })
        .parse(selected).selection;
      const source = detail.package.files.find((f) => f.path === "SKILL.md");
      if (!source) throw Error("SKILL.md missing");
      const content = previewText(source.contentBase64);
      if (generation === epoch.current)
        setReview({
          revision: detail.revision,
          selection,
          content,
          files: detail.package.files,
          path: "SKILL.md",
        });
    } catch (e) {
      if (generation === epoch.current) setError(String(e));
    } finally {
      if (generation === epoch.current) setBusy(false);
    }
  }
  async function select(action: "publish" | "deactivate" | "quarantine") {
    if (!review) return;
    const generation = ++epoch.current;
    setBusy(true);
    setError("");
    const body = {
      expectedRevision: review.selection?.revision ?? 0,
      skillRevision: review.revision.revision,
      contentHash: review.revision.contentHash,
      action,
    };
    const key = JSON.stringify({ id: review.revision.id, ...body });
    if (intent.current.key !== key)
      intent.current = { key, requestId: crypto.randomUUID() };
    try {
      const selection = selectionSchema.parse(
        await request(`/skills/${review.revision.id}/selection`, {
          ...body,
          requestId: intent.current.requestId,
        }),
      );
      if (generation === epoch.current) {
        setReview({ ...review, selection });
        setTrusted(false);
        intent.current = { key: "", requestId: "" };
      }
    } catch (e) {
      if (generation === epoch.current) setError(String(e));
    } finally {
      if (generation === epoch.current) setBusy(false);
    }
  }
  const state = review?.selection?.state;
  async function loadHistory(id: string, before?: number) {
    setBusy(true);
    setError("");
    try {
      const page = z
        .object({
          revisions: z.array(revisionSchema),
          nextBefore: z.number().nullable(),
        })
        .parse(
          await request(
            `/skills/${id}/history` + (before ? `?before=${before}` : ""),
          ),
        );
      setHistory((old) => ({
        id,
        revisions:
          before && old?.id === id
            ? [...old.revisions, ...page.revisions]
            : page.revisions,
        nextBefore: page.nextBefore,
      }));
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(false);
    }
  }
  async function loadSelectionHistory(id: string, before?: number) {
    setBusy(true);
    setError("");
    try {
      const page = z
        .object({
          entries: z.array(
            z.object({ sequence: z.number(), selection: selectionSchema }),
          ),
          nextBefore: z.number().nullable(),
        })
        .parse(
          await request(
            `/skills/${id}/selection-history` +
              (before ? `?before=${before}` : ""),
          ),
        );
      setSelectionLog((old) => ({
        id,
        entries:
          before && old?.id === id
            ? [...old.entries, ...page.entries]
            : page.entries,
        nextBefore: page.nextBefore,
      }));
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(false);
    }
  }
  const current =
    review?.selection?.skillRevision === review?.revision.revision;
  const label = (value: string | undefined) =>
    value === "published"
      ? zh
        ? "已啟用"
        : "Enabled"
      : value === "inactive"
        ? zh
          ? "已停用"
          : "Inactive"
        : value === "quarantined"
          ? zh
            ? "已隔離"
            : "Quarantined"
          : zh
            ? "未信任"
            : "Untrusted";
  return (
    <details className="model-settings skill-settings" open>
      <summary>{zh ? "技能" : "Skills"}</summary>
      <SkillDiscovery
        locale={locale}
        request={request}
        onImported={() => void refresh()}
      />
      <SkillImport
        key={updating ? `${updating.id}:${updating.revision}` : "new"}
        target={updating}
        locale={locale}
        request={request}
        onImported={() => {
          setUpdating(undefined);
          void refresh();
        }}
      />
      {updating && (
        <button onClick={() => setUpdating(undefined)}>
          {zh ? "取消更新" : "Cancel update"}
        </button>
      )}
      <p>
        {zh
          ? "審查固定版本後再啟用。技能不會授予額外工具權限；新版本只影響新工作。"
          : "Review a fixed revision before enabling it. Skills grant no extra tool permissions; version changes affect new Works."}
      </p>
      <button disabled={busy} onClick={() => void refresh()}>
        {zh ? "載入／重新整理技能" : "Load / refresh skills"}
      </button>
      {error && <p role="alert">{error}</p>}
      {nextCursor && (
        <button disabled={busy} onClick={() => void refresh(nextCursor)}>
          {zh ? "載入更多技能" : "Load more skills"}
        </button>
      )}
      {busy && <p role="status">{zh ? "處理中…" : "Working…"}</p>}
      {loaded && !items.length && (
        <p>{zh ? "尚無匯入的技能。" : "No imported skills yet."}</p>
      )}
      {items.map((item) => (
        <article className="model-card" key={item.id}>
          <strong>{item.metadata.name}</strong>
          <p>{item.metadata.description}</p>
          <p>
            {item.scope.kind === "user"
              ? zh
                ? "個人"
                : "User"
              : zh
                ? "專案"
                : "Project"}{" "}
            · r{item.revision}
          </p>
          <button disabled={busy} onClick={() => void open(item)}>
            {zh ? "審查此版本" : "Review this revision"}
          </button>
          <button disabled={busy} onClick={() => setUpdating(item)}>
            {zh ? "匯入新版" : "Import new revision"}
          </button>
          <button disabled={busy} onClick={() => void loadHistory(item.id)}>
            {zh ? "版本歷史" : "Revision history"}
          </button>
          <button
            disabled={busy}
            onClick={() => void loadSelectionHistory(item.id)}
          >
            {zh
              ? "發布／回滾／撤銷歷史"
              : "Publication / rollback / revocation history"}
          </button>
          {history?.id === item.id && (
            <div>
              {history.revisions.map((entry) => (
                <p key={entry.revision}>
                  <button
                    disabled={busy}
                    onClick={() => void open(item, entry.revision)}
                  >
                    r{entry.revision} · {entry.contentHash.slice(0, 16)}
                  </button>
                </p>
              ))}
              {history.nextBefore && (
                <button
                  disabled={busy}
                  onClick={() => void loadHistory(item.id, history.nextBefore!)}
                >
                  {zh ? "更早版本" : "Earlier revisions"}
                </button>
              )}
            </div>
          )}
          {selectionLog?.id === item.id && (
            <div>
              {selectionLog.entries.map((entry) => (
                <p key={entry.sequence}>
                  #{entry.sequence} · r{entry.selection.skillRevision} ·{" "}
                  {label(entry.selection.state)} ·{" "}
                  {entry.selection.contentHash.slice(0, 16)}
                </p>
              ))}
              {selectionLog.nextBefore && (
                <button
                  disabled={busy}
                  onClick={() =>
                    void loadSelectionHistory(item.id, selectionLog.nextBefore!)
                  }
                >
                  {zh ? "更早操作" : "Earlier changes"}
                </button>
              )}
            </div>
          )}
          {review?.revision.id === item.id && (
            <section aria-label={zh ? "技能版本審查" : "Skill revision review"}>
              <p role="status">
                {zh ? "審查版本" : "Reviewing"} r{review.revision.revision} ·{" "}
                {label(current ? state : undefined)}
                {review.selection && !current
                  ? ` · ${zh ? "目前選擇" : "Current selection"} r${review.selection.skillRevision}`
                  : ""}
              </p>
              <div className="actions">
                <button
                  disabled={busy || review.revision.revision <= 1}
                  onClick={() => void open(item, review.revision.revision - 1)}
                >
                  {zh ? "上一版本" : "Previous revision"}
                </button>
                <button
                  disabled={busy || review.revision.revision >= item.revision}
                  onClick={() => void open(item, review.revision.revision + 1)}
                >
                  {zh ? "下一版本" : "Next revision"}
                </button>
              </div>
              <p>
                {zh ? "來源" : "Source"}：{review.revision.source.reference}
                <br />
                {zh ? "授權聲明" : "Declared license"}：
                {review.revision.source.license}
              </p>
              <label>
                {zh ? "檢視套件檔案" : "Review package file"}
                <select
                  disabled={busy}
                  value={review.path}
                  onChange={(e) => {
                    const file = review.files.find(
                      (file) => file.path === e.target.value,
                    );
                    if (file) {
                      setTrusted(false);
                      setReview({
                        ...review,
                        path: file.path,
                        content: previewText(file.contentBase64),
                      });
                    }
                  }}
                >
                  {review.files.map((file) => (
                    <option key={file.path} value={file.path}>
                      {file.path}
                    </option>
                  ))}
                </select>
              </label>
              {review.content === null ? (
                <p role="status">
                  {zh
                    ? "二進位檔案：僅顯示下方大小與雜湊，不在頁面執行。"
                    : "Binary file: size and hash below; not executed in this page."}
                </p>
              ) : (
                <pre className="memory-content approval-proposal">
                  {review.content}
                </pre>
              )}
              <SkillDiff
                key={`${review.revision.id}:${review.revision.revision}:${review.path}`}
                id={review.revision.id}
                revision={review.revision.revision}
                path={review.path}
                locale={locale}
                request={request}
              />
              <details>
                <summary>
                  {zh ? "檔案與版本證據" : "Files and revision evidence"}
                </summary>
                <p>{review.revision.contentHash}</p>
                {review.revision.files.map((file) => (
                  <p key={file.path}>
                    {file.path} · {file.bytes} B
                    <br />
                    {file.sha256}
                  </p>
                ))}
              </details>
              <fieldset disabled={busy}>
                <label className="model-vision-toggle">
                  <input
                    type="checkbox"
                    checked={trusted}
                    onChange={(e) => setTrusted(e.target.checked)}
                  />
                  {zh
                    ? "我已檢視此版本內容及來源"
                    : "I reviewed this revision and its source"}
                </label>
                <div className="actions">
                  <button
                    disabled={
                      !trusted ||
                      (current && state === "quarantined") ||
                      (current && state === "published")
                    }
                    onClick={() => void select("publish")}
                  >
                    {zh ? "信任並啟用此版本" : "Trust and enable revision"}
                  </button>
                  <button
                    disabled={!current || state !== "published"}
                    onClick={() => void select("deactivate")}
                  >
                    {zh ? "停用" : "Deactivate"}
                  </button>
                  <button
                    disabled={
                      !trusted ||
                      (review.selection !== null && !current) ||
                      state === "quarantined"
                    }
                    onClick={() => void select("quarantine")}
                  >
                    {zh ? "隔離此版本" : "Quarantine revision"}
                  </button>
                </div>
                <p>
                  {zh
                    ? "隔離會阻止受影響工作後續使用；不會撤回已完成的操作。"
                    : "Quarantine blocks subsequent use by affected Works; completed actions are not undone."}
                </p>
                {review.selection && !current && (
                  <button
                    onClick={() =>
                      void open(item, review.selection!.skillRevision)
                    }
                  >
                    {zh ? "檢視目前選擇的版本" : "Review current selection"}
                  </button>
                )}
              </fieldset>
            </section>
          )}
        </article>
      ))}
    </details>
  );
}
