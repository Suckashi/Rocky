import { useEffect, useRef, useState } from "react";
import { z } from "zod";
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
  const [items, setItems] = useState<Artifact[]>([]),
    [selected, setSelected] = useState<Artifact>(),
    [text, setText] = useState<string>(),
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
    void request("/artifacts")
      .then((value) => {
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
    setError("");
    setBusy(true);
    try {
      const value = z
        .object({ text: z.string() })
        .parse(await request(`/artifacts/${item.id}/preview`));
      if (current === epoch.current) setText(value.text);
    } catch (e) {
      if (current === epoch.current) setError(String(e));
    } finally {
      if (current === epoch.current) setBusy(false);
    }
  }
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
            {zh
              ? "不可變快照 · 原始文字預覽（不執行 HTML 或腳本）"
              : "Immutable snapshot · source text preview (HTML and scripts do not execute)"}
          </p>
          <a
            href={`/api/v1/artifacts/${selected.id}/files/${selected.entry}`}
            download
          >
            <Download size={16} />
            {zh ? "下載原始檔案" : "Download original file"}
          </a>
          {text !== undefined && (
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
