import { useEffect, useRef, useState } from "react";
import type { Approval } from "../../../packages/contracts/src/index.js";
import { writePreviewSchema } from "../../../packages/contracts/src/workspaces.js";
import type { z } from "zod";

export function WriteProposal({
  approval,
  locale,
  request,
}: {
  approval: Approval;
  locale: "zh" | "en";
  request: (path: string, body?: unknown) => Promise<unknown>;
}) {
  const [preview, setPreview] = useState<z.infer<typeof writePreviewSchema>>(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  async function load() {
    setBusy(true);
    setError("");
    try {
      const result = writePreviewSchema.parse(
        await request(`/approvals/${approval.id}/preview`, {
          expectedRevision: approval.revision,
          intentFingerprint: approval.intentFingerprint,
        }),
      );
      if (mounted.current) setPreview(result);
    } catch (error) {
      if (mounted.current)
        setError(
          error instanceof Error ? error.message : "Preview unavailable",
        );
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  return (
    <>
      <p>
        <strong>{String(approval.args.path)}</strong>
      </p>
      <p>
        {locale === "zh"
          ? "核准只適用下方完整新內容；檔案若已改變，本次寫入會停止。拒絕不會更動檔案。"
          : "Approval covers the complete new content below. A changed file stops this write. Rejection leaves the file unchanged."}
      </p>
      <div className="proposal-review">
        <button disabled={busy} onClick={() => void load()}>
          {busy
            ? locale === "zh"
              ? "讀取差異…"
              : "Loading changes…"
            : locale === "zh"
              ? "檢視差異"
              : "Review changes"}
        </button>
      </div>
      {error && <p role="alert">{error}</p>}
      {preview && (
        <details open className="write-diff">
          <summary>
            {locale === "zh"
              ? `刪除 ${preview.removedLines} 行 · 新增 ${preview.addedLines} 行`
              : `${preview.removedLines} removed · ${preview.addedLines} added`}
          </summary>
          {!preview.complete && (
            <p role="status">
              {locale === "zh"
                ? "差異已截斷，這不是完整 patch。請另外檢查原始檔案與完整新內容。"
                : "Changes are truncated; this is not a complete patch. Review the original file and complete new content separately."}
            </p>
          )}
          <pre
            className="approval-proposal diff-preview"
            tabIndex={0}
            aria-label={locale === "zh" ? "檔案差異" : "File changes"}
          >
            {preview.rows.map((row, index) => (
              <span className={`diff-${row.kind}`} key={index}>
                {row.kind === "add" ? "+" : row.kind === "remove" ? "−" : " "}
                {row.text.replace(/\n$/, "")}
                {row.truncated ? "…" : ""}
              </span>
            ))}
          </pre>
          {preview.previousHasBOM !== preview.nextHasBOM && (
            <p>
              UTF-8 BOM: {preview.previousHasBOM ? "yes" : "no"} →{" "}
              {preview.nextHasBOM ? "yes" : "no"}
            </p>
          )}
          {preview.previousLineEnding !== preview.nextLineEnding && (
            <p>
              {locale === "zh" ? "行尾格式：" : "Line endings: "}
              {preview.previousLineEnding.toUpperCase()} →{" "}
              {preview.nextLineEnding.toUpperCase()}
            </p>
          )}
          <p>
            {locale === "zh"
              ? "結尾換行：原始 "
              : "Trailing newline: original "}
            {preview.previousEndsWithNewline
              ? locale === "zh"
                ? "有"
                : "yes"
              : locale === "zh"
                ? "無"
                : "no"}
            {locale === "zh" ? " → 新內容 " : " → new "}
            {preview.nextEndsWithNewline
              ? locale === "zh"
                ? "有"
                : "yes"
              : locale === "zh"
                ? "無"
                : "no"}
          </p>
        </details>
      )}
      <details open={!preview}>
        <summary>
          {locale === "zh" ? "待寫入完整內容" : "Complete proposed content"}
        </summary>
        <pre className="approval-proposal" tabIndex={0}>
          {String(approval.args.content)}
        </pre>
      </details>
      <details>
        <summary>
          {locale === "zh" ? "原始檔案驗證" : "Original file verification"}
        </summary>
        <code>
          {String(
            approval.args.expectedHash ??
              (locale === "zh"
                ? "新檔案：目標必須不存在"
                : "New file: target must not exist"),
          )}
        </code>
      </details>
    </>
  );
}
