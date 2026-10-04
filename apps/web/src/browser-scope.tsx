import { useEffect, useState } from "react";
import { z } from "zod";
import {
  browserProfileSchema,
  type BrowserProfile,
} from "../../../packages/contracts/src/browser.js";
export function BrowserScope({
  locale,
  origins,
  onOrigins,
  selected,
  onSelect,
  request,
}: {
  locale: "zh" | "en";
  origins: string;
  onOrigins: (value: string) => void;
  selected: string;
  onSelect: (id: string) => void;
  request: (path: string, body?: unknown) => Promise<unknown>;
}) {
  const [profiles, setProfiles] = useState<BrowserProfile[]>([]),
    [refresh, setRefresh] = useState(0),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    void request("/browser-profiles")
      .then((value) => {
        if (active) {
          setProfiles(
            z
              .object({ profiles: z.array(browserProfileSchema) })
              .parse(value)
              .profiles.filter((profile) => profile.sharingPolicy === "shared"),
          );
          setError("");
        }
      })
      .catch((e) => {
        if (active) setError(String(e));
      });
    return () => {
      active = false;
    };
  }, [request, refresh]);
  const zh = locale === "zh";
  return (
    <div>
      <label>
        {zh ? "Browser profile" : "Browser profile"}
        <select
          value={selected}
          onChange={(event) => onSelect(event.target.value)}
        >
          <option value="">
            {zh
              ? "新乾淨 profile／不使用 Browser"
              : "New clean profile / no Browser"}
          </option>
          {profiles.map((profile) => (
            <option key={profile.id} value={profile.id}>
              {profile.accountLabel} · {profile.id.slice(0, 8)}
            </option>
          ))}
        </select>
      </label>
      <button type="button" onClick={() => setRefresh((value) => value + 1)}>
        {zh ? "更新可共享清單" : "Refresh shared profiles"}
      </button>
      {selected ? (
        <p>
          {zh
            ? "本 Work 將共用此 profile 的登入帳號與 cookies，沿用已核准的網站範圍。"
            : "This Work will share this profile's signed-in accounts and cookies within its approved site origins."}
        </p>
      ) : (
        <label>
          {zh
            ? "Browser 允許的 origins（每行一個；留空不授權）"
            : "Allowed Browser origins (one per line; empty grants no access)"}
          <textarea
            value={origins}
            onChange={(event) => onOrigins(event.target.value)}
            placeholder="https://example.com"
          />
          <small>
            {zh
              ? "每項工作使用乾淨 profile。導覽與頁面操作仍需精確核准。"
              : "Each Work receives a clean profile. Navigation and page actions still require exact approval."}
          </small>
        </label>
      )}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
