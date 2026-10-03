import { useEffect, useState } from "react";
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
