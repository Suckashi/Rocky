import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import type { Approval } from "../../../packages/contracts/src/index.js";
import { memoryWritePreviewSchema } from "../../../packages/contracts/src/memory.js";

export function MemoryProposal({
  approval,
  locale,
  request,
}: {
  approval: Approval;
  locale: "zh" | "en";
  request: (path: string, body?: unknown) => Promise<unknown>;
}) {
  const zh = locale === "zh";
  const [preview, setPreview] =
    useState<z.infer<typeof memoryWritePreviewSchema>>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const epoch = useRef(0);
  useEffect(
    () => () => {
      epoch.current++;
    },
    [],
  );
  async function load() {
    const current = ++epoch.current;
    setBusy(true);
    setError("");
    setPreview(undefined);
    try {
      const result = memoryWritePreviewSchema.parse(
        await request(`/approvals/${approval.id}/memory-preview`, {
          expectedRevision: approval.revision,
          intentFingerprint: approval.intentFingerprint,
        }),
      );
      if (current === epoch.current) setPreview(result);
    } catch (e) {
      if (current === epoch.current) setError(String(e));
    } finally {
      if (current === epoch.current) setBusy(false);
    }
  }
  const privacy = (value: boolean | null) =>
    value === null
      ? zh
        ? "新記憶"
        : "New memory"
      : value
        ? zh
          ? "私密"
          : "Private"
        : zh
          ? "非私密"
          : "Not private";
  return (
    <div className="proposal-review memory-review">
      <button disabled={busy} onClick={() => void load()}>
        {busy
          ? zh
            ? "讀取差異…"
            : "Loading changes…"
          : zh
            ? "檢視記憶差異"
            : "Review memory changes"}
      </button>
      {error && <p role="alert">{error}</p>}
      {preview && (
        <>
          <p>
            {privacy(preview.previousPrivate)} → {privacy(preview.nextPrivate)}
          </p>
          <p>
            {zh ? "刪除" : "Removed"} {preview.removedLines} ·{" "}
            {zh ? "新增" : "Added"} {preview.addedLines}
          </p>
          {!preview.complete && (
            <p role="status">
              {zh
                ? "差異已截斷，請檢查完整記憶內容。"
                : "Changes are truncated. Review the complete memory content."}
            </p>
          )}
          <pre
            className="approval-proposal diff-preview"
            tabIndex={0}
            aria-label={zh ? "記憶差異" : "Memory changes"}
          >
            {preview.rows.map((row, index) => (
              <span className={`diff-${row.kind}`} key={index}>
                {row.kind === "add" ? "+" : row.kind === "remove" ? "−" : " "}
                {row.text.replace(/\n$/, "")}
                {row.truncated ? "…" : ""}
              </span>
            ))}
          </pre>
          <details>
            <summary>
              {zh ? "文件來源變更" : "Document source changes"} (
              {preview.previousSources.length} → {preview.nextSources.length})
            </summary>
            {(["previousSources", "nextSources"] as const).map((key) => (
              <div key={key}>
                <strong>
                  {key === "previousSources"
                    ? zh
                      ? "原有來源"
                      : "Previous sources"
                    : zh
                      ? "新來源"
                      : "New sources"}
                </strong>
                <ul>
                  {preview[key].map((source) => (
                    <li key={source.id + ":" + source.revision}>
                      <a
                        href={`/api/v1/documents/${source.id}/download?revision=${source.revision}`}
                      >
                        {zh ? "文件" : "Document"} · r{source.revision}
                      </a>
                      <details>
                        <summary>{zh ? "來源 ID" : "Source ID"}</summary>
                        {source.id}
                      </details>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </details>
        </>
      )}
    </div>
  );
}
