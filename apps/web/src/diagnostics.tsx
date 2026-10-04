import { useState } from "react";
export function Diagnostics({
  locale,
  request,
}: {
  locale: "zh" | "en";
  request: (path: string, body?: unknown) => Promise<unknown>;
}) {
  const zh = locale === "zh",
    [preview, setPreview] = useState(""),
    [reviewed, setReviewed] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function load() {
    setBusy(true);
    setReviewed(false);
    setError("");
    try {
      setPreview(
        JSON.stringify(await request("/diagnostics/preview"), null, 2),
      );
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(false);
    }
  }
  function download() {
    if (!preview || !reviewed) return;
    const url = URL.createObjectURL(
        new Blob([preview], { type: "application/json" }),
      ),
      link = document.createElement("a");
    link.href = url;
    link.download = "rocky-diagnostics.json";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <details className="model-settings">
      <summary>{zh ? "本機診斷匯出" : "Local diagnostic export"}</summary>
      <p>
        {zh
          ? "僅包含版本、狀態計數與最近事件識別；請審查後再下載。下載不會傳送給第三方。"
          : "Version, status counts and recent event identities only. Review before downloading; nothing is sent to third parties."}
      </p>
      <button disabled={busy} onClick={() => void load()}>
        {zh ? "產生預覽" : "Generate preview"}
      </button>
      {error && <p role="alert">{error}</p>}
      {preview && (
        <>
          <pre>{preview}</pre>
          <label>
            <input
              type="checkbox"
              checked={reviewed}
              onChange={(event) => setReviewed(event.target.checked)}
            />
            {zh ? "已審查此份內容" : "I reviewed this exact bundle"}
          </label>
          <button disabled={!reviewed || busy} onClick={download}>
            {zh ? "下載已審查內容" : "Download reviewed bundle"}
          </button>
        </>
      )}
    </details>
  );
}
