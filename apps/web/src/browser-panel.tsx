import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import {
  browserProfileSchema,
  browserSnapshotSchema,
  type BrowserProfile,
  type BrowserSnapshot,
} from "../../../packages/contracts/src/browser.js";
import type { Work } from "../../../packages/contracts/src/index.js";
export function BrowserPanel({
  work,
  cursor,
  locale,
  request,
}: {
  work?: Work;
  cursor: string;
  locale: "zh" | "en";
  request: (path: string, body?: unknown) => Promise<unknown>;
}) {
  const zh = locale === "zh",
    profileId = work?.browserProfileId;
  const [profile, setProfile] = useState<BrowserProfile>(),
    [snapshot, setSnapshot] = useState<BrowserSnapshot | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [refresh, setRefresh] = useState(0);
  const [accountLabel, setAccountLabel] = useState("");
  const ids = useRef(new Map<string, string>()),
    epoch = useRef(0);
  useEffect(() => {
    const current = ++epoch.current;
    setProfile(undefined);
    setSnapshot(null);
    setError("");
    if (profileId)
      void request(`/browser-profiles/${profileId}`)
        .then((response) => {
          if (current !== epoch.current) return;
          const value = z
            .object({
              profile: browserProfileSchema,
              snapshot: browserSnapshotSchema.nullable(),
            })
            .parse(response);
          setProfile(value.profile);
          setSnapshot(value.snapshot);
        })
        .catch((e) => {
          if (current === epoch.current) setError(String(e));
        });
    return () => {
      epoch.current++;
    };
  }, [profileId, cursor, refresh, request]);
  async function control(action: "open" | "close" | "take" | "release") {
    if (!profile) return;
    const key = `${profile.id}:${profile.revision}:${action}`,
      requestId = ids.current.get(key) ?? crypto.randomUUID();
    ids.current.set(key, requestId);
    setBusy(true);
    setError("");
    try {
      await request(`/browser-profiles/${profile.id}/control`, {
        requestId,
        profileRevision: profile.revision,
        action,
      });
      ids.current.delete(key);
      setRefresh((value) => value + 1);
    } catch (e) {
      setError(String(e));
      setRefresh((value) => value + 1);
    } finally {
      setBusy(false);
    }
  }
  async function capture() {
    if (!profile) return;
    const current = epoch.current;
    setBusy(true);
    setError("");
    try {
      const value = browserSnapshotSchema.parse(
        await request(`/browser-profiles/${profile.id}/snapshot`, {}),
      );
      if (current === epoch.current) setSnapshot(value);
      setRefresh((value) => value + 1);
    } catch (e) {
      if (current === epoch.current) setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  async function share(action: "share" | "revoke" = "share") {
    if (!profile || (action === "share" && !accountLabel.trim())) return;
    const key = `${action}:${profile.id}:${profile.revision}:${accountLabel}`,
      requestId = ids.current.get(key) ?? crypto.randomUUID();
    ids.current.set(key, requestId);
    setBusy(true);
    setError("");
    try {
      await request(`/browser-profiles/${profile.id}/sharing`, {
        requestId,
        profileRevision: profile.revision,
        action,
        ...(action === "share" ? { accountLabel } : {}),
      });
      ids.current.delete(key);
      setRefresh((value) => value + 1);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  if (!profileId)
    return (
      <p>
        {zh
          ? "此 Work 未授予 Browser 範圍。建立工作時可在進階選項指定允許的網站 origins；每項工作會建立獨立乾淨 profile。"
          : "This Work has no Browser scope. Specify allowed site origins in advanced Work options to create its own clean profile."}
      </p>
    );
  return (
    <div className="computer-setup">
      {error && <p role="alert">{error}</p>}
      {profile && (
        <>
          <h3>Browser · {profile.state}</h3>
          <p>
            {profile.sharingPolicy === "shared"
              ? `${zh ? "共享帳號範圍" : "Shared account scope"}: ${profile.accountLabel}`
              : zh
                ? "此工作專用 profile；不共享登入資料。"
                : "Dedicated Work profile; login data is not shared."}
          </p>
          <p>
            {zh
              ? "Native browser 使用 OS 權限，網路限制為 application-only，完整 egress 尚未驗證。"
              : "Native browser uses OS permissions. Network restrictions are application-only; full egress remains unverified."}
          </p>
          <p>{profile.allowedOrigins.join(" · ")}</p>
          {profile.error && <p role="status">{profile.error}</p>}
          <button
            type="button"
            disabled={
              busy ||
              !["closed", "unknown", "unavailable"].includes(profile.state)
            }
            onClick={() => void control("open")}
          >
            {zh ? "開啟專用瀏覽器" : "Open dedicated browser"}
          </button>
          <button
            type="button"
            disabled={busy || profile.state !== "ready"}
            onClick={() => void capture()}
          >
            {zh ? "擷取新快照" : "Capture fresh snapshot"}
          </button>
          <button
            type="button"
            disabled={busy || profile.state !== "ready"}
            onClick={() => void control("take")}
          >
            {zh ? "人工接管此 profile" : "Take control of this profile"}
          </button>
          <button
            type="button"
            disabled={busy || profile.state !== "owner"}
            onClick={() => void control("release")}
          >
            {zh ? "交還控制並要求新快照" : "Release; require fresh snapshot"}
          </button>
          <button
            type="button"
            disabled={busy || profile.state === "closed"}
            onClick={() => void control("close")}
          >
            {zh ? "關閉此 profile" : "Close this profile"}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => setRefresh((value) => value + 1)}
          >
            {zh ? "更新狀態" : "Refresh status"}
          </button>
          <details>
            <summary>
              {zh
                ? "明確共享登入 profile"
                : "Explicitly share this login profile"}
            </summary>
            <p>
              {zh
                ? "允許之後建立的 Work 明確選取此 profile，共用其中的 cookies 與登入帳號。這些工作會序列化；原本的網站範圍不變。"
                : "Allow future Works to explicitly select this profile and share its cookies and signed-in accounts. Works are serialized; allowed site origins remain unchanged."}
            </p>
            <label>
              {zh
                ? "帳號範圍名稱（不填密碼）"
                : "Account scope label (no passwords)"}
              <input
                maxLength={120}
                value={accountLabel}
                onChange={(event) => setAccountLabel(event.target.value)}
              />
            </label>
            <button
              type="button"
              disabled={busy || !accountLabel.trim()}
              onClick={() => void share()}
            >
              {zh
                ? "允許選取並共享登入狀態"
                : "Allow selection and sharing of login state"}
            </button>
            {profile.sharingPolicy === "shared" && (
              <button
                type="button"
                disabled={busy}
                onClick={() => void share("revoke")}
              >
                {zh
                  ? "撤銷共享及其他 Work 的存取"
                  : "Revoke sharing and other Works' access"}
              </button>
            )}
          </details>
        </>
      )}
      {snapshot && (
        <>
          <p>
            {zh ? "擷取時間" : "Captured"}:{" "}
            <time dateTime={snapshot.capturedAt}>{snapshot.capturedAt}</time> ·{" "}
            {snapshot.stale
              ? zh
                ? "舊快照，不能用於操作"
                : "Stale; cannot be used for actions"
              : zh
                ? "快照，非即時影片"
                : "Snapshot, not live video"}
          </p>
          <p>{snapshot.url}</p>
          <img
            style={{ maxWidth: "100%" }}
            src={`/api/v1/browser-snapshots/${snapshot.snapshotId}/image`}
            alt={zh ? "此 Work 的瀏覽器快照" : "Browser snapshot for this Work"}
          />
          <details>
            <summary>
              {zh ? "頁面文字與識別" : "Page text and identity"}
            </summary>
            <pre>
              {JSON.stringify(
                {
                  profileId: snapshot.profileId,
                  environmentId: snapshot.environmentId,
                  pageId: snapshot.pageId,
                  navigationRevision: snapshot.navigationRevision,
                  snapshotId: snapshot.snapshotId,
                },
                null,
                2,
              )}
            </pre>
            <pre>{snapshot.text}</pre>
          </details>
        </>
      )}
    </div>
  );
}
