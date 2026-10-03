import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import {
  grantSchema,
  type Grant,
} from "../../../packages/contracts/src/grants.js";
import type { Work } from "../../../packages/contracts/src/index.js";
export function WorkGrants({
  work,
  locale,
  request,
}: {
  work: Work;
  locale: "zh" | "en";
  request: (path: string, body?: unknown) => Promise<unknown>;
}) {
  const [scope, setScope] = useState<"user" | "project" | "task">("task");
  const [includePrivate, setIncludePrivate] = useState(false);
  const grantIntent = useRef({ key: "", id: "" });
  const [open, setOpen] = useState(false),
    [grants, setGrants] = useState<Grant[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    let active = true;
    void request(`/works/${work.id}/grants`)
      .then((value) => {
        const parsed = z
          .strictObject({ grants: z.array(grantSchema) })
          .parse(value);
        if (active) {
          setGrants(parsed.grants);
          setError("");
        }
      })
      .catch((e) => {
        if (active) setError(String(e));
      });
    return () => {
      active = false;
    };
  }, [open, work.id, work.revision, request]);
  async function revoke(grant: Grant) {
    setBusy(true);
    setError("");
    try {
      const result = grantSchema.parse(
        await request(`/works/${work.id}/grants/${grant.id}/revoke`, {
          requestId: crypto.randomUUID(),
          expectedRevision: grant.revision,
        }),
      );
      setGrants((previous) =>
        previous.map((g) => (g.id === result.id ? result : g)),
      );
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  async function issueMemory() {
    setBusy(true);
    setError("");
    const key = JSON.stringify([
      work.id,
      work.runId,
      work.executionSessionId,
      scope,
      includePrivate,
    ]);
    if (grantIntent.current.key !== key)
      grantIntent.current = { key, id: crypto.randomUUID() };
    try {
      const grant = grantSchema.parse(
        await request(`/works/${work.id}/memory-read-grants`, {
          requestId: grantIntent.current.id,
          scope,
          includePrivate,
        }),
      );
      setGrants((previous) => [
        ...previous.filter((g) => g.id !== grant.id),
        grant,
      ]);
      grantIntent.current = { key: "", id: "" };
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <details
      className="work-grants"
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary>{locale === "zh" ? "此工作權限" : "Work permissions"}</summary>
      <p>
        {locale === "zh"
          ? "權限只限此工作。撤銷可阻止後續使用，不會撤回已送出的操作。"
          : "Permissions apply only to this Work. Revocation blocks future use; it does not undo dispatched operations."}
      </p>
      {error && <p role="alert">{error}</p>}
      {work.mode === "configured" &&
        work.runMode === "normal" &&
        ["queued", "running", "waiting_approval"].includes(work.status) && (
          <fieldset disabled={busy}>
            <legend>
              {locale === "zh"
                ? "允許此工作讀取記憶"
                : "Allow memory reads for this Work"}
            </legend>
            <label>
              {locale === "zh" ? "授權記憶範圍" : "Memory permission scope"}
              <select
                value={scope}
                onChange={(e) => setScope(e.target.value as typeof scope)}
              >
                <option value="task">
                  {locale === "zh" ? "此工作" : "This Work"}
                </option>
                {work.workspaceId && (
                  <option value="project">
                    {locale === "zh" ? "此工作綁定的專案" : "Bound project"}
                  </option>
                )}
                <option value="user">
                  {locale === "zh" ? "個人記憶" : "User memory"}
                </option>
              </select>
            </label>
            <label>
              <input
                type="checkbox"
                checked={includePrivate}
                onChange={(e) => setIncludePrivate(e.target.checked)}
              />
              {locale === "zh"
                ? "包含私密記憶（可能送至此工作的模型）"
                : "Include private memory (may be sent to this Work’s model)"}
            </label>
            <button
              type="button"
              disabled={grants.some(
                (g) =>
                  !g.revoked &&
                  g.runId === work.runId &&
                  g.executionSessionId === work.executionSessionId &&
                  g.memory?.scope === scope &&
                  g.memory.includePrivate === includePrivate &&
                  (!g.expiresAt || Date.parse(g.expiresAt) > Date.now()),
              )}
              onClick={() => void issueMemory()}
            >
              {locale === "zh"
                ? "授權讀取此範圍"
                : "Grant reads for this scope"}
            </button>
          </fieldset>
        )}
      {grants.map((grant) => (
        <div key={grant.id}>
          <span>
            {grant.resource === "memory"
              ? locale === "zh"
                ? "讀取已授權記憶範圍"
                : "Read granted memory scope"
              : grant.effect === "known_read"
                ? locale === "zh"
                  ? work.mode === "configured"
                    ? "讀取綁定的工作區"
                    : "讀取合成資料"
                  : work.mode === "configured"
                    ? "Read bound workspace"
                    : "Read synthetic data"
                : locale === "zh"
                  ? "建立新項目"
                  : "Create new items"}
          </span>{" "}
          {grant.memory && (
            <span>
              {
                {
                  user: locale === "zh" ? "個人" : "User",
                  project: locale === "zh" ? "專案" : "Project",
                  task: locale === "zh" ? "此工作" : "This Work",
                }[grant.memory.scope]
              }{" "}
              ·{" "}
              {grant.memory.includePrivate
                ? locale === "zh"
                  ? "包含私密"
                  : "Includes private"
                : locale === "zh"
                  ? "不含私密"
                  : "Excludes private"}{" "}
            </span>
          )}
          {grant.revoked ? (
            <span>{locale === "zh" ? "已撤銷" : "Revoked"}</span>
          ) : (
            <button
              type="button"
              disabled={busy}
              onClick={() => void revoke(grant)}
            >
              {locale === "zh" ? "撤銷此權限" : "Revoke permission"}
            </button>
          )}
        </div>
      ))}
    </details>
  );
}
