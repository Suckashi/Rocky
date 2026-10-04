import { useEffect, useRef, useState } from "react";
import { z } from "zod";
const schema = z.object({
  path: z.string(),
  files: z.array(
    z.object({
      path: z.string(),
      status: z.enum(["added", "removed", "modified"]),
      previousBytes: z.number(),
      nextBytes: z.number(),
      previousHash: z.string().nullable(),
      nextHash: z.string().nullable(),
    }),
  ),
  binary: z.boolean(),
  preview: z
    .object({
      complete: z.boolean(),
      rows: z.array(
        z.object({
          kind: z.enum(["add", "remove", "context"]),
          text: z.string(),
          truncated: z.boolean(),
        }),
      ),
    })
    .nullable(),
});
export function SkillDiff({
  id,
  revision,
  path,
  locale,
  request,
}: {
  id: string;
  revision: number;
  path: string;
  locale: "zh" | "en";
  request: (path: string, body?: unknown) => Promise<unknown>;
}) {
  const zh = locale === "zh",
    alive = useRef(true);
  const [value, setValue] = useState<z.infer<typeof schema>>(),
    [baseRevision, setBaseRevision] = useState(Math.max(1, revision - 1)),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  async function load(selectedPath = path) {
    setBusy(true);
    setError("");
    try {
      const result = schema.parse(
        await request(
          `/skills/${id}/diff?from=${baseRevision}&to=${revision}&path=${encodeURIComponent(selectedPath)}`,
        ),
      );
      if (alive.current) setValue(result);
    } catch (e) {
      if (alive.current) setError(String(e));
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  if (revision <= 1) return null;
  const selected = value?.files.find((file) => file.path === value.path);
  return (
    <div className="skill-diff">
      <label>
        {zh ? "比較基底修訂" : "Base revision"}
        <input
          type="number"
          min={1}
          max={revision - 1}
          value={baseRevision}
          disabled={busy}
          onChange={(event) => {
            setBaseRevision(Number(event.target.value));
            setValue(undefined);
          }}
        />
      </label>
      <button
        disabled={
          busy ||
          !Number.isSafeInteger(baseRevision) ||
          baseRevision < 1 ||
          baseRevision >= revision
        }
        onClick={() => void load()}
      >
        {zh ? "比較所選版本" : "Compare selected revision"}
      </button>
      {error && <p role="alert">{error}</p>}
      {value && (
        <>
          <p>
            r{baseRevision} → r{revision} · {value.path}
          </p>
          <details>
            <summary>
              {zh ? "全部檔案變更" : "All file changes"} ({value.files.length})
            </summary>
            {value.files.map((file) => (
              <p key={file.path}>
                {
                  {
                    added: zh ? "新增" : "Added",
                    removed: zh ? "刪除" : "Removed",
                    modified: zh ? "修改" : "Modified",
                  }[file.status]
                }{" "}
                ·{" "}
                <button disabled={busy} onClick={() => void load(file.path)}>
                  {file.path}
                </button>{" "}
                ({file.previousBytes} → {file.nextBytes} B)
              </p>
            ))}
          </details>
          {value.binary ? (
            <p>
              {zh
                ? "二進位檔案不提供文字差異。"
                : "Text diff unavailable for binary files."}
            </p>
          ) : (
            value.preview && (
              <>
                {!value.preview.complete && (
                  <p role="status">
                    {zh
                      ? "差異已截斷；請分別檢視完整檔案。"
                      : "Diff truncated; review the complete files separately."}
                  </p>
                )}
                <pre
                  className="diff-preview"
                  aria-label={zh ? "技能檔案差異" : "Skill file diff"}
                >
                  {value.preview.rows.map((row, i) => (
                    <span key={i} className={`diff-${row.kind}`}>
                      {row.kind === "add"
                        ? "+"
                        : row.kind === "remove"
                          ? "−"
                          : " "}
                      {row.text.replace(/\n$/, "")}
                      {row.truncated ? "…" : ""}
                    </span>
                  ))}
                </pre>
              </>
            )
          )}
          {selected && (
            <details className="skill-diff-evidence">
              <summary>
                {zh ? "檔案比較證據" : "File comparison evidence"}
              </summary>
              <p>
                r{revision - 1} · {selected.previousBytes} B
              </p>
              <p>
                SHA-256:{" "}
                <code>
                  {selected.previousHash ?? (zh ? "不存在" : "Absent")}
                </code>
              </p>
              <p>
                r{revision} · {selected.nextBytes} B
              </p>
              <p>
                SHA-256:{" "}
                <code>{selected.nextHash ?? (zh ? "不存在" : "Absent")}</code>
              </p>
            </details>
          )}
        </>
      )}
    </div>
  );
}
