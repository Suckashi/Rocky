import { useEffect, useRef, useState, type FormEvent } from "react";
import { z } from "zod";
import { Folder, FileText } from "lucide-react";
import {
  workspaceSchema,
  type Workspace,
} from "../../../packages/contracts/src/workspaces.js";
const listingSchema = z.object({
  path: z.string(),
  entries: z.array(
    z.object({ name: z.string(), kind: z.enum(["directory", "file"]) }),
  ),
  truncated: z.boolean(),
});
const previewSchema = z.object({
  path: z.string(),
  sha256: z.string(),
  size: z.number(),
  text: z.string(),
});
export function Workspaces({
  locale,
  request,
  onSelect,
}: {
  locale: "zh" | "en";
  request: (path: string, body?: unknown) => Promise<unknown>;
  onSelect?: (workspace: Workspace) => void;
}) {
  const zh = locale === "zh",
    epoch = useRef(0);
  const [items, setItems] = useState<Workspace[]>([]),
    [name, setName] = useState(""),
    [root, setRoot] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(true),
    [selected, setSelected] = useState<Workspace>(),
    [listing, setListing] = useState<z.infer<typeof listingSchema>>(),
    [preview, setPreview] = useState<z.infer<typeof previewSchema>>();
  useEffect(() => {
    let disposed = false;
    void request("/workspaces")
      .then((value) => {
        if (!disposed)
          setItems(
            z.object({ workspaces: z.array(workspaceSchema) }).parse(value)
              .workspaces,
          );
      })
      .catch((e) => {
        if (!disposed) setError(String(e));
      })
      .finally(() => {
        if (!disposed) setBusy(false);
      });
    return () => {
      disposed = true;
      epoch.current++;
    };
  }, [request]);
  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const value = workspaceSchema.parse(
        await request("/workspaces", {
          id: crypto.randomUUID(),
          requestId: crypto.randomUUID(),
          expectedRevision: 0,
          name,
          root,
        }),
      );
      setItems((old) => [...old, value]);
      setName("");
      setRoot("");
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  async function browse(workspace: Workspace, path = "") {
    const current = ++epoch.current;
    setBusy(true);
    setError("");
    setSelected(workspace);
    setListing(undefined);
    setPreview(undefined);
    try {
      const value = listingSchema.parse(
        await request(
          `/workspaces/${workspace.id}/files?revision=${workspace.revision}&path=${encodeURIComponent(path)}`,
        ),
      );
      if (current === epoch.current) setListing(value);
    } catch (e) {
      if (current === epoch.current) setError(String(e));
    } finally {
      if (current === epoch.current) setBusy(false);
    }
  }
  async function read(path: string) {
    if (!selected) return;
    const current = ++epoch.current;
    setBusy(true);
    setError("");
    setPreview(undefined);
    try {
      const value = previewSchema.parse(
        await request(
          `/workspaces/${selected.id}/file?revision=${selected.revision}&path=${encodeURIComponent(path)}`,
        ),
      );
      if (current === epoch.current) setPreview(value);
    } catch (e) {
      if (current === epoch.current) setError(String(e));
    } finally {
      if (current === epoch.current) setBusy(false);
    }
  }
  return (
    <section className="model-settings workspace-settings">
      <h2>{zh ? "本機工作區" : "Local workspaces"}</h2>
      <p>
        {zh
          ? "註冊後可自行瀏覽。選擇工作區，並在送出前明確啟用唯讀權限，才能讓該工作與臨時子任務讀取。Native 使用你的 OS 權限，並非 OS sandbox。寫入與建立 worktree 需精確核准；shell 尚未提供。"
          : "Browse registered folders yourself. Select a workspace and explicitly enable read scope before sending to allow that Work and its ephemeral children to read. Native uses your OS permissions, not an OS sandbox. Writes and worktree creation require exact approval; shell execution is not available."}
      </p>
      <form onSubmit={(event) => void save(event)}>
        <fieldset disabled={busy}>
          <label>
            {zh ? "名稱" : "Name"}
            <input
              required
              maxLength={120}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label>
            {zh ? "資料夾絕對路徑" : "Absolute folder path"}
            <input
              required
              value={root}
              onChange={(e) => setRoot(e.target.value)}
              placeholder="D:\Projects\my-project"
            />
          </label>
          <button className="primary" disabled={busy}>
            {zh ? "註冊工作區" : "Register workspace"}
          </button>
        </fieldset>
      </form>
      {busy && <p role="status">{zh ? "讀取中…" : "Loading…"}</p>}
      {error && <p role="alert">{error}</p>}
      {!items.length && !busy && !error && (
        <p role="status">
          {zh ? "尚未註冊工作區。" : "No registered workspace."}
        </p>
      )}
      {items.map((workspace) => (
        <article className="model-card" key={workspace.id}>
          <h3>{workspace.name}</h3>
          <p>{workspace.root}</p>
          <button disabled={busy} onClick={() => void browse(workspace)}>
            {zh ? "瀏覽檔案" : "Browse files"}
          </button>
          {onSelect && (
            <button disabled={busy} onClick={() => onSelect(workspace)}>
              {zh ? "選擇給下一個工作" : "Select for next Work"}
            </button>
          )}
        </article>
      ))}
      {selected && listing && (
        <section>
          <h3>
            {selected.name} / {listing.path || "/"}
          </h3>
          {listing.path && (
            <button
              disabled={busy}
              onClick={() =>
                void browse(
                  selected,
                  listing.path.split("/").slice(0, -1).join("/"),
                )
              }
            >
              {zh ? "上一層" : "Parent folder"}
            </button>
          )}
          {!listing.entries.length && (
            <p>
              {zh
                ? "此資料夾沒有可顯示項目。"
                : "No visible entries in this folder."}
            </p>
          )}
          {listing.entries.map((entry) => (
            <div className="workspace-file-row" key={entry.name}>
              <button
                title={entry.name}
                disabled={busy}
                onClick={() => {
                  const path = [listing.path, entry.name]
                    .filter(Boolean)
                    .join("/");
                  void (entry.kind === "directory"
                    ? browse(selected, path)
                    : read(path));
                }}
              >
                {entry.kind === "directory" ? (
                  <Folder size={16} aria-hidden="true" />
                ) : (
                  <FileText size={16} aria-hidden="true" />
                )}
                <span>{entry.name}</span>
              </button>
            </div>
          ))}
          {listing.truncated && (
            <p role="status">
              {zh
                ? "目錄顯示已達上限；可直接瀏覽子資料夾。"
                : "Listing limit reached; browse a subfolder."}
            </p>
          )}
          {preview && (
            <article className="model-card">
              <h3>{preview.path}</h3>
              <p>
                {preview.size} bytes · SHA-256: {preview.sha256}
              </p>
              <p>
                {zh
                  ? "預覽可能遮罩敏感內容；雜湊對應原始檔案。"
                  : "Preview may redact sensitive content; the hash identifies original bytes."}
              </p>
              <pre
                className="workspace-text-preview"
                tabIndex={0}
                aria-label={zh ? "文字預覽" : "Text preview"}
              >
                {preview.text}
              </pre>
            </article>
          )}
        </section>
      )}
    </section>
  );
}
