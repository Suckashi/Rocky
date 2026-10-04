import { useEffect, useRef, useState } from "react";
import { z } from "zod";
const importedSchema = z
  .object({
    id: z.uuid(),
    revision: z.number().int(),
    contentHash: z.string(),
    license: z.string(),
  })
  .nullable();
const listing = z.object({
  available: z.boolean(),
  truncated: z.boolean(),
  nextCursor: z.string().nullable().optional(),
  items: z.array(
    z.object({
      name: z.string(),
      contentHash: z.string().optional(),
      error: z.string().optional(),
      imported: importedSchema.optional(),
      metadata: z
        .object({ description: z.string(), license: z.string().optional() })
        .passthrough()
        .optional(),
    }),
  ),
});
const snapshotSchema = z.object({
  package: z.unknown(),
  contentHash: z.string(),
  scope: z.unknown(),
  imported: importedSchema.optional(),
  source: z.object({
    type: z.enum(["global", "project"]),
    reference: z.string(),
  }),
});
export function SkillDiscovery({
  locale,
  request,
  onImported,
}: {
  locale: "zh" | "en";
  request: (path: string, body?: unknown) => Promise<unknown>;
  onImported: () => void;
}) {
  const zh = locale === "zh";
  const [workspaces, setWorkspaces] = useState<{ id: string; name: string }[]>(
      [],
    ),
    [scope, setScope] = useState("user"),
    [result, setResult] = useState<z.infer<typeof listing>>(),
    [license, setLicense] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [saved, setSaved] = useState<string[]>([]);
  const alive = useRef(true),
    intent = useRef<{ key: string; body: unknown } | undefined>(undefined);
  useEffect(() => {
    alive.current = true;
    void request("/workspaces")
      .then((value) => {
        if (alive.current)
          setWorkspaces(
            z
              .object({
                workspaces: z.array(
                  z.object({ id: z.string(), name: z.string() }),
                ),
              })
              .parse(value).workspaces,
          );
      })
      .catch((e) => {
        if (alive.current) setError(String(e));
      });
    return () => {
      alive.current = false;
    };
  }, [request]);
  const selectedScope =
    scope === "user" ? { kind: "user" } : { kind: "project", projectId: scope };
  async function discover(after?: string) {
    setBusy(true);
    setError("");
    if (!after) setResult(undefined);
    intent.current = undefined;
    try {
      const value = listing.parse(
        await request("/skills/discover", {
          scope: selectedScope,
          ...(after ? { after } : {}),
        }),
      );
      if (alive.current) {
        setResult((old) =>
          after && old
            ? { ...value, items: [...old.items, ...value.items] }
            : value,
        );
        if (!after) setSaved([]);
      }
    } catch (e) {
      if (alive.current) setError(String(e));
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  async function importSource(item: z.infer<typeof listing>["items"][number]) {
    setBusy(true);
    setError("");
    try {
      const key = JSON.stringify([
        scope,
        item.name,
        item.contentHash,
        license.trim(),
      ]);
      if (intent.current?.key !== key) {
        const snapshot = snapshotSchema.parse(
          await request("/skills/source-snapshot", {
            scope: selectedScope,
            name: item.name,
            expectedHash: item.contentHash,
          }),
        );
        intent.current = {
          key,
          body: {
            requestId: crypto.randomUUID(),
            id: snapshot.imported?.id ?? crypto.randomUUID(),
            expectedRevision: snapshot.imported?.revision ?? 0,
            scope: selectedScope,
            source: { ...snapshot.source, license: license.trim() },
            package: snapshot.package,
          },
        };
      }
      await request("/skills/import", intent.current.body);
      if (alive.current) {
        setSaved((old) => [...old, item.name]);
        onImported();
      }
    } catch (e) {
      if (alive.current) setError(String(e));
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  return (
    <details className="skill-discovery">
      <summary>
        {zh ? "探索本地技能來源" : "Discover local skill sources"}
      </summary>
      <fieldset className="model-card" disabled={busy}>
        <p>
          {zh
            ? "僅讀取全域或已註冊專案的 .agents/skills。探索不會啟用技能；匯入固定快照後仍需審查。"
            : "Read .agents/skills in your home or a registered project. Discovery does not enable skills; imported snapshots still require review."}
        </p>
        <label>
          {zh ? "技能來源範圍" : "Skill source scope"}
          <select
            value={scope}
            onChange={(e) => {
              setScope(e.target.value);
              setResult(undefined);
              setSaved([]);
              setError("");
              intent.current = undefined;
            }}
          >
            <option value="user">
              {zh ? "全域 ~/.agents/skills" : "Global ~/.agents/skills"}
            </option>
            {workspaces.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        </label>
        <button onClick={() => void discover()}>
          {busy
            ? zh
              ? "處理中…"
              : "Working…"
            : zh
              ? "探索來源"
              : "Discover sources"}
        </button>
        {error && <p role="alert">{error}</p>}
        {result && (
          <>
            {!result.available ? (
              <p role="status">
                {zh ? "來源目錄不存在。" : "Source directory does not exist."}
              </p>
            ) : !result.items.length ? (
              <p role="status">
                {zh
                  ? "來源目錄沒有技能。"
                  : "No skills in this source directory."}
              </p>
            ) : null}
            {result.truncated && (
              <p role="status">
                {zh
                  ? "還有其他來源，可繼續載入。"
                  : "More sources are available."}
              </p>
            )}
            {result.nextCursor && (
              <button
                disabled={busy}
                onClick={() => void discover(result.nextCursor!)}
              >
                {zh ? "載入更多來源" : "Load more sources"}
              </button>
            )}
            {!!result.items.length && (
              <label>
                {zh ? "來源匯入授權聲明" : "Source import license declaration"}
                <input
                  value={license}
                  maxLength={4096}
                  onChange={(e) => setLicense(e.target.value)}
                />
              </label>
            )}
            {result.items.map((item) => (
              <div className="model-card" key={item.name}>
                <strong>{item.name}</strong>
                <p>{item.metadata?.description}</p>
                {item.metadata?.license && (
                  <p>
                    {zh ? "套件聲明" : "Package declaration"}:{" "}
                    {item.metadata.license}
                  </p>
                )}
                {item.error ? (
                  <p>
                    {zh
                      ? "來源無效或無法安全讀取。"
                      : "Source invalid or cannot be read safely."}
                  </p>
                ) : (
                  <>
                    <details>
                      <summary>{zh ? "來源雜湊" : "Source hash"}</summary>
                      <code>{item.contentHash}</code>
                    </details>
                    <button
                      disabled={
                        !license.trim() ||
                        saved.includes(item.name) ||
                        item.imported?.contentHash === item.contentHash
                      }
                      onClick={() => void importSource(item)}
                    >
                      {item.imported
                        ? zh
                          ? `更新既有技能 r${item.imported.revision}（尚不啟用）`
                          : `Update existing r${item.imported.revision} (not enabled)`
                        : zh
                          ? "匯入未信任快照"
                          : "Import untrusted snapshot"}
                    </button>
                    {saved.includes(item.name) && (
                      <p role="status">
                        {zh ? "已匯入，尚未啟用。" : "Imported, not enabled."}
                      </p>
                    )}
                  </>
                )}
              </div>
            ))}
          </>
        )}
      </fieldset>
    </details>
  );
}
