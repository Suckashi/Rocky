import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { DocumentEditor } from "./document-editor.js";
import {
  documentSchema,
  documentContentSchema,
  type RockyDocument,
} from "../../../packages/contracts/src/documents.js";
import { FileText, Download, ArrowLeft } from "lucide-react";
import {
  artifactSchema,
  type Artifact,
} from "../../../packages/contracts/src/artifacts.js";
export function Artifacts({
  locale,
  request,
  revision,
}: {
  locale: "zh" | "en";
  revision: string;
  request: (path: string, body?: unknown) => Promise<unknown>;
}) {
  const zh = locale === "zh",
    epoch = useRef(0);
  const library = useRef<HTMLElement>(null),
    heading = useRef<HTMLHeadingElement>(null),
    previousSelection = useRef<string | undefined>(undefined);
  const [documents, setDocuments] = useState<RockyDocument[]>([]);
  const [editing, setEditing] =
    useState<z.infer<typeof documentContentSchema>>();
  const previousEditing = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!editing && previousEditing.current)
      library.current
        ?.querySelector<HTMLButtonElement>(
          `[data-document="${previousEditing.current}"]`,
        )
        ?.focus();
    previousEditing.current = editing?.document.id;
  }, [editing]);
  const createRequests = useRef(new Map<string, string>());
  const [items, setItems] = useState<Artifact[]>([]),
    [selected, setSelected] = useState<Artifact>(),
    [text, setText] = useState<string>(),
    [html, setHtml] = useState<string>(),
    [showSource, setShowSource] = useState(false),
    [busy, setBusy] = useState(true),
    [error, setError] = useState("");
  useEffect(() => {
    if (selected) heading.current?.focus();
    else if (previousSelection.current)
      library.current
        ?.querySelector<HTMLButtonElement>(
          `[data-artifact="${previousSelection.current}"]`,
        )
        ?.focus();
    previousSelection.current = selected?.id;
  }, [selected]);
  useEffect(() => {
    let active = true;
    void Promise.all([request("/artifacts"), request("/documents")])
      .then(([value, docs]) => {
        if (active)
          setDocuments(
            z.object({ documents: z.array(documentSchema) }).parse(docs)
              .documents,
          );
        if (active)
          setItems(
            z.object({ artifacts: z.array(artifactSchema) }).parse(value)
              .artifacts,
          );
      })
      .catch((e) => {
        if (active) setError(String(e));
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
      epoch.current++;
    };
  }, [request, revision]);
  async function preview(item: Artifact) {
    const current = ++epoch.current;
    setSelected(item);
    setText(undefined);
    setHtml(undefined);
    setShowSource(false);
    setError("");
    setBusy(true);
    try {
      const value = z
        .object({ text: z.string(), renderedHtml: z.string().optional() })
        .parse(await request(`/artifacts/${item.id}/preview`));
      if (current === epoch.current) {
        setText(value.text);
        setHtml(value.renderedHtml);
      }
    } catch (e) {
      if (current === epoch.current) setError(String(e));
    } finally {
      if (current === epoch.current) setBusy(false);
    }
  }
  async function editDocument(id: string) {
    setBusy(true);
    setError("");
    try {
      setEditing(
        documentContentSchema.parse(await request(`/documents/${id}`)),
      );
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  async function createDocument() {
    if (!selected) return;
    setBusy(true);
    setError("");
    const requestId =
      createRequests.current.get(selected.id) ?? crypto.randomUUID();
    createRequests.current.set(selected.id, requestId);
    try {
      const value = documentContentSchema.parse(
        await request("/documents", { requestId, artifactId: selected.id }),
      );
      setDocuments((old) => [
        value.document,
        ...old.filter((d) => d.id !== value.document.id),
      ]);
      setEditing(value);
      setSelected(undefined);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  if (editing)
    return (
      <DocumentEditor
        key={editing.document.id}
        value={editing}
        locale={locale}
        request={request}
        onBack={() => setEditing(undefined)}
      />
    );
  return (
    <section
      className="artifact-library"
      ref={library}
      aria-label={zh ? "成果庫" : "Artifact library"}
    >
      {error && <p role="alert">{error}</p>}
      {busy && <p role="status">{zh ? "載入中…" : "Loading…"}</p>}
      {selected ? (
        <>
          <button
            onClick={() => {
              epoch.current++;
              setSelected(undefined);
              setText(undefined);
              setBusy(false);
            }}
          >
            <ArrowLeft size={16} />
            {zh ? "返回成果" : "Back to results"}
          </button>
          <h2 ref={heading} tabIndex={-1}>
            {selected.title}
          </h2>
          <p>
            {html
              ? zh
                ? "不可變快照 · 受限 HTML 預覽"
                : "Immutable snapshot · restricted HTML preview"
              : zh
                ? "不可變快照 · 原始文字預覽"
                : "Immutable snapshot · source text preview"}
          </p>
          <a
            href={`/api/v1/artifacts/${selected.id}/files/${selected.entry}`}
            download
          >
            <Download size={16} />
            {zh ? "下載原始檔案" : "Download original file"}
          </a>
          {["text/plain", "text/markdown"].includes(
            selected.files[0]?.mime ?? "",
          ) && (
            <button disabled={busy} onClick={() => void createDocument()}>
              {zh ? "建立可編輯副本" : "Create editable copy"}
            </button>
          )}
          {html && (
            <>
              <p>
                {zh
                  ? "受限 HTML 預覽：停用腳本、導覽及外部資源。原始檔案未改寫。"
                  : "Restricted HTML preview: scripts, navigation and external resources are disabled. The original file is unchanged."}
              </p>
              <button onClick={() => setShowSource(!showSource)}>
                {showSource
                  ? zh
                    ? "顯示 HTML 預覽"
                    : "Show HTML preview"
                  : zh
                    ? "顯示原始碼"
                    : "Show source"}
              </button>
              {!showSource && (
                <iframe
                  title={zh ? "HTML 成果預覽" : "HTML artifact preview"}
                  className="html-artifact-preview"
                  sandbox=""
                  referrerPolicy="no-referrer"
                  srcDoc={html}
                />
              )}
            </>
          )}
          {text !== undefined && (!html || showSource) && (
            <pre
              className="artifact-preview"
              tabIndex={0}
              aria-label={zh ? "成果內容" : "Artifact content"}
            >
              {text}
            </pre>
          )}
          <details>
            <summary>{zh ? "來源與校驗" : "Source and integrity"}</summary>
            <p>{selected.source.path}</p>
            <p>
              {zh ? "来源工作" : "Source Work"}: {selected.workId}
            </p>
            <p>SHA-256: {selected.files[0]?.sha256}</p>
            <p>
              {zh
                ? "證據是已確認的寫入收據，不代表測試通過。"
                : "Evidence is the confirmed write receipt, not a claim that tests passed."}
            </p>
          </details>
        </>
      ) : (
        <>
          <p>
            {zh
              ? "保存已確認寫入的檔案快照。工作區後續修改不會覆寫成果。"
              : "Saved snapshots of confirmed file writes. Later workspace edits do not overwrite results."}
          </p>
          {!busy && !items.length && (
            <p>
              {zh
                ? "尚無成果。可在工作的「操作與對帳」中保存已成功寫入的檔案。"
                : "No results yet. Save a successful write from a Work’s Operations and reconciliation."}
            </p>
          )}
          {documents.map((document) => (
            <article className="artifact-card" key={document.id}>
              <FileText size={20} />
              <div>
                <h3>{document.title}</h3>
                <p>
                  {zh ? "文件版本" : "Document revision"} {document.revision}
                </p>
              </div>
              <button
                disabled={busy}
                data-document={document.id}
                onClick={() => void editDocument(document.id)}
              >
                {zh ? "編輯" : "Edit"}
              </button>
            </article>
          ))}
          {items.map((item) => (
            <article className="artifact-card" key={item.id}>
              <FileText size={20} />
              <div>
                <h3>{item.title}</h3>
                <p>
                  {item.files[0]?.name} · {item.files[0]?.size} bytes
                </p>
              </div>
              <button
                data-artifact={item.id}
                onClick={() => void preview(item)}
              >
                {zh ? "預覽" : "Preview"}
              </button>
            </article>
          ))}
        </>
      )}
    </section>
  );
}
