import { useEffect, useState } from "react";
import {
  attachmentSchema,
  type Attachment,
  type AttachmentRef,
} from "../../../packages/contracts/src/attachments.js";
export function AttachmentPicker({
  value,
  onChange,
  onBusyChange,
  request,
  locale,
  disabled = false,
}: {
  value: Attachment[];
  onChange: (value: Attachment[]) => void;
  onBusyChange?: (busy: boolean) => void;
  request: (path: string, body?: unknown) => Promise<unknown>;
  locale: "zh" | "en";
  disabled?: boolean;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <section
      style={{ minWidth: 0, maxWidth: "100%", overflowWrap: "anywhere" }}
      aria-label={locale === "zh" ? "附件" : "Attachments"}
    >
      <label>
        {locale === "zh"
          ? "加入文字／Markdown／PNG／JPEG 附件（最多 8 個）"
          : "Attach text / Markdown / PNG / JPEG (up to 8)"}
        <input
          type="file"
          style={{ width: "100%", minWidth: 0, boxSizing: "border-box" }}
          accept=".txt,.md,.markdown,.png,.jpg,.jpeg"
          disabled={disabled || busy || value.length >= 8}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (!file) return;
            setError("");
            if (file.size > 2097152) {
              setError(
                locale === "zh"
                  ? "檔案不可超過 2 MiB；文字上限 64 KiB。"
                  : "Maximum 2 MiB; text limit 64 KiB.",
              );
              return;
            }
            const extension = file.name.split(".").pop()?.toLowerCase();
            const mimeType =
              extension === "png"
                ? "image/png"
                : ["jpg", "jpeg"].includes(extension ?? "")
                  ? "image/jpeg"
                  : ["md", "markdown"].includes(extension ?? "")
                    ? "text/markdown"
                    : extension === "txt"
                      ? "text/plain"
                      : undefined;
            if (!mimeType) {
              setError("Unsupported file type");
              return;
            }
            setBusy(true);
            onBusyChange?.(true);
            void file
              .arrayBuffer()
              .then((buffer) => {
                let binary = "";
                for (const byte of new Uint8Array(buffer))
                  binary += String.fromCharCode(byte);
                return request("/attachments", {
                  requestId: crypto.randomUUID(),
                  name: file.name,
                  mimeType,
                  base64: btoa(binary),
                });
              })
              .then((result) =>
                onChange([...value, attachmentSchema.parse(result)]),
              )
              .catch((reason) => setError(String(reason)))
              .finally(() => {
                setBusy(false);
                onBusyChange?.(false);
              });
          }}
        />
      </label>
      <p>
        {locale === "zh"
          ? "上傳只保存附件；送出工作或修正後才授權該工作讀取。圖片會去除中繼資料；請確認方向與內容。"
          : "Upload saves the attachment; sending grants the Work access. Images have metadata removed; check orientation and content."}
      </p>
      {value.map((item) => (
        <div key={item.id}>
          <a href={`/api/v1/attachments/${item.id}/content`} download>
            {item.name}
          </a>{" "}
          <small>
            {item.mimeType} · {item.bytes} B · {item.sha256.slice(0, 12)}
          </small>{" "}
          <button
            type="button"
            disabled={disabled || busy}
            onClick={() =>
              onChange(value.filter((entry) => entry.id !== item.id))
            }
          >
            {locale === "zh" ? "從待送清單移除" : "Remove from draft"}
          </button>
        </div>
      ))}
      {value
        .filter((item) => item.mimeType.startsWith("image/"))
        .map((item) => (
          <img
            key={item.id}
            src={`/api/v1/attachments/${item.id}/content`}
            alt={item.name}
            style={{ maxWidth: "100%", maxHeight: 240, objectFit: "contain" }}
          />
        ))}
      {busy && (
        <p role="status">
          {locale === "zh"
            ? "檢查並保存附件…"
            : "Validating and saving attachment…"}
        </p>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
export const attachmentRefs = (items: Attachment[]): AttachmentRef[] =>
  items.map(({ id, revision, sha256 }) => ({ id, revision, sha256 }));
export function AttachmentLinks({ refs }: { refs?: AttachmentRef[] }) {
  return refs?.length ? (
    <ul>
      {refs.map((item) => (
        <AttachmentLink key={item.id} reference={item} />
      ))}
    </ul>
  ) : null;
}
function AttachmentLink({ reference }: { reference: AttachmentRef }) {
  const [metadata, setMetadata] = useState<Attachment>();
  useEffect(() => {
    const abort = new AbortController();
    void fetch(`/api/v1/attachments/${reference.id}`, {
      signal: abort.signal,
      credentials: "same-origin",
    })
      .then(async (response) => {
        if (!response.ok) throw Error("Attachment metadata unavailable");
        const value = attachmentSchema.parse(await response.json());
        if (
          value.sha256 !== reference.sha256 ||
          value.revision !== reference.revision
        )
          throw Error("Attachment identity changed");
        if (!abort.signal.aborted) setMetadata(value);
      })
      .catch(() => {
        /* The exact immutable download reference remains visible. */
      });
    return () => abort.abort();
  }, [reference.id, reference.sha256, reference.revision]);
  return (
    <li>
      <a href={`/api/v1/attachments/${reference.id}/content`} download>
        {metadata?.name ?? reference.id} · {reference.sha256.slice(0, 12)}
      </a>
      {metadata?.mimeType.startsWith("image/") && (
        <details>
          <summary>{metadata.name}</summary>
          <img
            loading="lazy"
            src={`/api/v1/attachments/${reference.id}/content`}
            alt={metadata.name}
            style={{ maxWidth: "100%", maxHeight: 480, objectFit: "contain" }}
          />
        </details>
      )}
    </li>
  );
}
