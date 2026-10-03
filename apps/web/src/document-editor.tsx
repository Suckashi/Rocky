import { useEffect, useRef, useState } from "react";
import {
  documentContentSchema,
  type RockyDocument,
} from "../../../packages/contracts/src/documents.js";
type Value = { document: RockyDocument; content: string };
type Draft = { base: Value; title: string; content: string };
const drafts = new Map<string, Draft>();
const dirty = (draft: Draft) =>
  draft.title !== draft.base.document.title ||
  draft.content !== draft.base.content;
function unload(event: BeforeUnloadEvent) {
  if ([...drafts.values()].some(dirty)) {
    event.preventDefault();
    event.returnValue = "";
  }
}
function keep(draft: Draft) {
  drafts.set(draft.base.document.id, draft);
  if ([...drafts.values()].some(dirty))
    window.addEventListener("beforeunload", unload);
  else window.removeEventListener("beforeunload", unload);
}
export function DocumentEditor({
  value,
  locale,
  request,
  onBack,
}: {
  value: Value;
  locale: "zh" | "en";
  request: (path: string, body?: unknown) => Promise<unknown>;
  onBack: () => void;
}) {
  const zh = locale === "zh";
  const heading = useRef<HTMLHeadingElement>(null);
  const source = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, []);
  const [draft, setDraft] = useState<Draft>(
    () =>
      drafts.get(value.document.id) ?? {
        base: value,
        title: value.document.title,
        content: value.content,
      },
  );
  const [latest, setLatest] = useState<Value>(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [saved, setSaved] = useState(false);
  const receipt = useRef<{ intent: string; id: string } | undefined>(undefined);
  const [historyRevision, setHistoryRevision] = useState("1");
  const [historical, setHistorical] = useState<Value>();
  const validHistory =
    /^\d+$/.test(historyRevision) &&
    Number(historyRevision) >= 1 &&
    Number(historyRevision) <= draft.base.document.revision;
  async function readHistory() {
    if (!validHistory) return;
    setBusy(true);
    setError("");
    setHistorical(undefined);
    try {
      setHistorical(
        documentContentSchema.parse(
          await request(
            `/documents/${value.document.id}?revision=${Number(historyRevision)}`,
          ),
        ),
      );
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  function change(next: Draft) {
    keep(next);
    setDraft(next);
    setSaved(false);
  }
  async function save() {
    setBusy(true);
    setError("");
    setSaved(false);
    const body = {
      expectedRevision: draft.base.document.revision,
      title: draft.title,
      content: draft.content,
    };
    const intent = JSON.stringify(body);
    if (receipt.current?.intent !== intent)
      receipt.current = { intent, id: crypto.randomUUID() };
    try {
      const result = documentContentSchema.parse(
        await request(`/documents/${value.document.id}`, {
          ...body,
          requestId: receipt.current.id,
        }),
      );
      change({
        base: result,
        title: result.document.title,
        content: result.content,
      });
      setLatest(undefined);
      setSaved(true);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  async function compare() {
    setBusy(true);
    setError("");
    try {
      setLatest(
        documentContentSchema.parse(
          await request(`/documents/${value.document.id}`),
        ),
      );
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      className="document-editor"
      aria-label={zh ? "Markdown 文件編輯器" : "Markdown document editor"}
    >
      <button onClick={onBack} disabled={busy}>
        {zh ? "返回文件與成果" : "Back to documents & results"}
      </button>
      <h2 ref={heading} tabIndex={-1}>
        {zh ? "編輯文件" : "Edit document"}
      </h2>
      <p>
        {zh ? "版本" : "Revision"} {draft.base.document.revision} ·{" "}
        {dirty(draft)
          ? zh
            ? "未儲存草稿"
            : "Unsaved draft"
          : zh
            ? "已儲存"
            : "Saved"}
      </p>
      <p>
        {zh
          ? "修改會建立新版本，不會覆寫原始成果。草稿保留在目前頁面；重載前請儲存。編輯器使用 LF 換行。"
          : "Edits create a new revision without changing the original artifact. Drafts stay in this page; save before reloading. The editor uses LF line endings."}
      </p>
      <a
        href={`/api/v1/documents/${value.document.id}/download?revision=${draft.base.document.revision}`}
        download
      >
        {zh ? "下載已儲存版本" : "Download saved revision"}
      </a>
      <label>
        {zh ? "文件標題" : "Document title"}
        <input
          className="document-title"
          maxLength={120}
          value={draft.title}
          disabled={busy}
          onChange={(e) => change({ ...draft, title: e.target.value })}
        />
      </label>
      <label>
        {zh ? "Markdown 原始內容" : "Markdown source"}
        <textarea
          ref={source}
          value={draft.content}
          maxLength={65536}
          disabled={busy}
          onChange={(e) => change({ ...draft, content: e.target.value })}
          spellCheck={false}
        />
      </label>
      {error && <p role="alert">{error}</p>}
      {saved && (
        <p role="status">{zh ? "新版本已儲存。" : "New revision saved."}</p>
      )}
      <div className="actions">
        <button
          disabled={busy || !dirty(draft) || !draft.title.trim()}
          onClick={() => void save()}
        >
          {zh ? "儲存新版本" : "Save new revision"}
        </button>
        <button disabled={busy} onClick={() => void compare()}>
          {zh ? "檢視最新版本" : "Compare latest revision"}
        </button>
      </div>
      <details className="document-history">
        <summary>
          {zh ? "版本紀錄與還原" : "Revision history and restore"}
        </summary>
        <label>
          {zh ? "查看版本" : "View revision"}
          <input
            type="number"
            min="1"
            max={draft.base.document.revision}
            value={historyRevision}
            disabled={busy}
            onChange={(event) => {
              setHistoryRevision(event.target.value);
              setHistorical(undefined);
            }}
          />
        </label>
        <button
          disabled={busy || !validHistory}
          onClick={() => void readHistory()}
        >
          {zh ? "讀取歷史版本" : "Load historical revision"}
        </button>
        {historical && (
          <section className="document-comparison">
            <h3>
              {zh ? "歷史版本" : "Historical revision"}{" "}
              {historical.document.revision}
            </h3>
            <p>{historical.document.title}</p>
            <time dateTime={historical.document.updatedAt}>
              {historical.document.updatedAt}
            </time>
            <pre
              tabIndex={0}
              aria-label={zh ? "歷史版本內容" : "Historical revision content"}
            >
              {historical.content}
            </pre>
            <a
              href={`/api/v1/documents/${value.document.id}/download?revision=${historical.document.revision}`}
              download
            >
              {zh ? "下載此版本" : "Download this revision"}
            </a>
            <p>
              {dirty(draft)
                ? zh
                  ? "請先儲存目前草稿，再載入歷史版本。"
                  : "Save your current draft before loading a historical revision."
                : zh
                  ? "載入後仍需儲存新版本；不會刪除歷史或覆寫原始成果。"
                  : "After loading, save a new revision. History and the original artifact remain unchanged."}
            </p>
            <button
              disabled={busy || dirty(draft)}
              onClick={() => {
                change({
                  ...draft,
                  title: historical.document.title,
                  content: historical.content,
                });
                source.current?.focus();
              }}
            >
              {zh ? "載入此版本到草稿" : "Load this revision into draft"}
            </button>
          </section>
        )}
      </details>
      {latest && (
        <section className="document-comparison">
          <h3>
            {zh ? "伺服器最新版本" : "Latest server revision"}{" "}
            {latest.document.revision}
          </h3>
          <p>{latest.document.title}</p>
          <pre tabIndex={0}>{latest.content}</pre>
          <p>
            {zh
              ? "比較後可保留草稿、改以此版本為基準；下次儲存會完整取代該版本的內容。"
              : "After comparison, keep your draft against this revision. Saving will fully replace that revision’s content."}
          </p>
          <button
            disabled={busy}
            onClick={() => {
              change({ ...draft, base: latest });
              setLatest(undefined);
            }}
          >
            {zh ? "以此版本為基準保留草稿" : "Keep draft against this revision"}
          </button>
        </section>
      )}
    </section>
  );
}
