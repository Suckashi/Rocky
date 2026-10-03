import { useEffect, useRef, useState, type FormEvent } from "react";
import { z } from "zod";
import {
  memorySchema,
  type Memory,
} from "../../../packages/contracts/src/memory.js";
import {
  workspaceSchema,
  type Workspace,
} from "../../../packages/contracts/src/workspaces.js";
import type { Work } from "../../../packages/contracts/src/index.js";
import {
  documentSchema,
  type RockyDocument,
} from "../../../packages/contracts/src/documents.js";

const searchResult = z.object({
  items: z.array(memorySchema),
  truncated: z.boolean(),
});
export function MemorySettings({
  locale,
  request,
  works,
}: {
  locale: "zh" | "en";
  request: (path: string, body?: unknown) => Promise<unknown>;
  works: Work[];
}) {
  const zh = locale === "zh";
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [documents, setDocuments] = useState<RockyDocument[]>([]);
  const [scopeKey, setScopeKey] = useState("user");
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<Memory[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<{
    id: string;
    revision: number;
    content: string;
    status: Memory["status"];
    private: boolean;
    sources: Memory["sources"];
  }>();
  const [deleting, setDeleting] = useState<string>();
  const intent = useRef({ key: "", requestId: "" });
  const epoch = useRef(0);
  const scope = () =>
    scopeKey === "user"
      ? { kind: "user" }
      : { kind: scopeKey.split(":")[0], id: scopeKey.split(":")[1] };
  useEffect(() => {
    let active = true;
    void request("/workspaces")
      .then((value) => {
        if (active)
          setWorkspaces(
            z.object({ workspaces: z.array(workspaceSchema) }).parse(value)
              .workspaces,
          );
      })
      .catch((e) => {
        if (active) setError(String(e));
      });
    void request("/documents")
      .then((value) => {
        if (active)
          setDocuments(
            z.object({ documents: z.array(documentSchema) }).parse(value)
              .documents,
          );
      })
      .catch((e) => {
        if (active) setError(String(e));
      });
    return () => {
      active = false;
      epoch.current++;
    };
  }, [request]);
  async function search() {
    const current = ++epoch.current;
    setBusy(true);
    setError("");
    try {
      const result = searchResult.parse(
        await request("/memories/search", {
          scope: scope(),
          query,
          byteBudget: 16384,
        }),
      );
      if (current === epoch.current) {
        setItems(result.items);
        setTruncated(result.truncated);
        setSearched(true);
      }
    } catch (e) {
      if (current === epoch.current) setError(String(e));
    } finally {
      if (current === epoch.current) setBusy(false);
    }
  }
  function requestId(key: string) {
    if (intent.current.key !== key)
      intent.current = { key, requestId: crypto.randomUUID() };
    return intent.current.requestId;
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (!draft) return;
    setBusy(true);
    setError("");
    const {
      revision,
      id,
      content,
      status,
      private: isPrivate,
      sources,
    } = draft;
    const fields = { id, content, status, private: isPrivate, sources };
    const body = { ...fields, expectedRevision: revision, scope: scope() };
    try {
      await request("/memories", {
        ...body,
        requestId: requestId(JSON.stringify(body)),
      });
      setDraft(undefined);
      await search();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  async function remove(item: Memory) {
    setBusy(true);
    setError("");
    try {
      await request("/memories/" + item.id + "/delete", {
        expectedRevision: item.revision,
        requestId: requestId("delete:" + item.id + ":" + item.revision),
      });
      setDeleting(undefined);
      await search();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  const statuses = {
    unverified: zh ? "未驗證" : "Unverified",
    confirmed: zh ? "已確認" : "Confirmed",
    conflicted: zh ? "有衝突" : "Conflicted",
  };
  return (
    <details className="model-settings memory-settings">
      <summary>{zh ? "記憶" : "Memory"}</summary>
      <p>
        {zh
          ? "管理本地記憶。手動記憶會鎖定；模型讀取需另行授權給工作，Learning 尚未接入。"
          : "Manage local memory. Manual entries are locked; model reads require a separate Work grant. Learning is not connected yet."}
      </p>
      <fieldset disabled={busy || !!draft}>
        <label>
          {zh ? "記憶範圍" : "Memory scope"}
          <select
            value={scopeKey}
            onChange={(e) => {
              epoch.current++;
              setScopeKey(e.target.value);
              setItems([]);
              setTruncated(false);
              setSearched(false);
              setDeleting(undefined);
              setError("");
            }}
          >
            <option value="user">{zh ? "個人" : "User"}</option>
            {workspaces.map((w) => (
              <option key={w.id} value={"project:" + w.id}>
                {zh ? "專案：" : "Project: "}
                {w.name}
              </option>
            ))}
            {works
              .filter((w) => w.runMode !== "evaluation")
              .map((w) => (
                <option key={w.id} value={"task:" + w.id}>
                  {zh ? "工作：" : "Work: "}
                  {w.text.slice(0, 80)}
                </option>
              ))}
          </select>
        </label>
      </fieldset>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void search();
        }}
      >
        <fieldset disabled={busy}>
          <label>
            {zh ? "搜尋記憶" : "Search memory"}
            <input
              maxLength={128}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          <div className="actions">
            <button type="submit">
              {zh ? "搜尋／重新整理" : "Search / refresh"}
            </button>
            <button
              type="button"
              disabled={!!draft}
              onClick={() => {
                setDeleting(undefined);
                setDraft({
                  id: crypto.randomUUID(),
                  revision: 0,
                  content: "",
                  status: "unverified",
                  private: true,
                  sources: [],
                });
              }}
            >
              {zh ? "新增記憶" : "New memory"}
            </button>
          </div>
        </fieldset>
      </form>
      {error && <p role="alert">{error}</p>}
      {busy && <p role="status">{zh ? "處理中…" : "Working…"}</p>}
      {draft && (
        <form onSubmit={save} className="model-card">
          <fieldset disabled={busy}>
            <legend>
              {draft.revision
                ? zh
                  ? "編輯記憶"
                  : "Edit memory"
                : zh
                  ? "新增記憶"
                  : "New memory"}
            </legend>
            <label>
              {zh ? "記憶內容" : "Memory content"}
              <textarea
                required
                maxLength={4096}
                value={draft.content}
                onChange={(e) =>
                  setDraft({ ...draft, content: e.target.value })
                }
              />
            </label>
            <label>
              {zh ? "確認狀態" : "Verification status"}
              <select
                value={draft.status}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    status: e.target.value as Memory["status"],
                  })
                }
              >
                {Object.entries(statuses).map(([key, name]) => (
                  <option key={key} value={key}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
            <label className="model-vision-toggle">
              <input
                type="checkbox"
                checked={draft.private}
                onChange={(e) =>
                  setDraft({ ...draft, private: e.target.checked })
                }
              />
              {zh
                ? "私密（不得用於 Learning）"
                : "Private (excluded from Learning)"}
            </label>
            <label>
              {zh
                ? "加入文件來源（固定修訂）"
                : "Add document source (pinned revision)"}
              <select
                value=""
                disabled={draft.sources.length >= 16}
                onChange={(e) => {
                  const doc = documents.find((d) => d.id === e.target.value);
                  if (doc)
                    setDraft({
                      ...draft,
                      sources: [
                        ...draft.sources,
                        {
                          kind: "document",
                          id: doc.id,
                          revision: doc.revision,
                        },
                      ],
                    });
                }}
              >
                <option value="">
                  {zh ? "選擇文件…" : "Choose document…"}
                </option>
                {documents
                  .filter((d) => {
                    const selected = scope();
                    const workspaceId =
                      selected.kind === "project"
                        ? selected.id
                        : works.find((w) => w.id === selected.id)?.workspaceId;
                    return (
                      (selected.kind === "user" ||
                        d.scope.workspaceId === workspaceId) &&
                      !draft.sources.some(
                        (s) => s.id === d.id && s.revision === d.revision,
                      )
                    );
                  })
                  .map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.title} · r{d.revision}
                    </option>
                  ))}
              </select>
            </label>
            {draft.sources.map((s) => (
              <div key={s.id + ":" + s.revision} className="actions">
                <span>
                  {documents.find((d) => d.id === s.id)?.title ??
                    (zh ? "文件來源" : "Document source")}{" "}
                  · r{s.revision}
                </span>
                <button
                  type="button"
                  onClick={() =>
                    setDraft({
                      ...draft,
                      sources: draft.sources.filter((x) => x !== s),
                    })
                  }
                >
                  {zh ? "移除來源" : "Remove source"}
                </button>
              </div>
            ))}
            <div className="actions">
              <button type="submit">{zh ? "儲存記憶" : "Save memory"}</button>
              <button type="button" onClick={() => setDraft(undefined)}>
                {zh ? "放棄草稿" : "Discard draft"}
              </button>
            </div>
          </fieldset>
        </form>
      )}
      {truncated && (
        <p role="status">
          {zh
            ? "結果超過顯示上限，請縮小搜尋範圍。"
            : "Results exceed the display limit. Narrow your search."}
        </p>
      )}
      {!busy && !items.length && (
        <p>
          {searched
            ? zh
              ? "沒有符合的記憶。"
              : "No matching memories."
            : zh
              ? "選擇範圍後搜尋，或新增記憶。"
              : "Choose a scope and search, or create a memory."}
        </p>
      )}
      {items.map((item) => (
        <article className="model-card" key={item.id}>
          <div className="memory-content">{item.content}</div>
          {item.sources.length > 0 && (
            <details>
              <summary>
                {zh ? "文件來源" : "Document sources"} ({item.sources.length})
              </summary>
              <ul>
                {item.sources.map((s) => (
                  <li key={s.id + ":" + s.revision}>
                    <a
                      href={
                        "/api/v1/documents/" +
                        s.id +
                        "/download?revision=" +
                        s.revision
                      }
                    >
                      {documents.find((d) => d.id === s.id)?.title ??
                        (zh ? "文件" : "Document")}{" "}
                      · r{s.revision}
                    </a>
                  </li>
                ))}
              </ul>
            </details>
          )}
          <p>
            {statuses[item.status]} ·{" "}
            {item.private
              ? zh
                ? "私密"
                : "Private"
              : zh
                ? "非私密"
                : "Not private"}{" "}
            ·{" "}
            {item.locked
              ? zh
                ? "手動鎖定"
                : "Owner locked"
              : zh
                ? "模型建議"
                : "Model proposed"}{" "}
            · r{item.revision}
          </p>
          <div className="actions">
            <button
              disabled={busy || !!draft}
              onClick={() => {
                setDeleting(undefined);
                setDraft(item);
              }}
            >
              {zh ? "編輯" : "Edit"}
            </button>
            <button
              disabled={busy || !!draft}
              onClick={() => setDeleting(item.id)}
            >
              {zh ? "刪除" : "Delete"}
            </button>
          </div>
          {deleting === item.id && (
            <div>
              <p>
                {zh
                  ? "刪除此筆本地記憶及搜尋索引？"
                  : "Delete this local memory and its search index?"}
              </p>
              <div className="actions">
                <button disabled={busy} onClick={() => void remove(item)}>
                  {zh ? "確認刪除" : "Confirm deletion"}
                </button>
                <button disabled={busy} onClick={() => setDeleting(undefined)}>
                  {zh ? "取消" : "Cancel"}
                </button>
              </div>
            </div>
          )}
        </article>
      ))}
    </details>
  );
}
