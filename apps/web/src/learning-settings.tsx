import { useEffect, useRef, useState } from "react";
import { LearningEpisodes } from "./learning-episodes.js";
import { z } from "zod";
import { learningPolicySchema } from "../../../packages/contracts/src/learning.js";
export function LearningSettings({
  locale,
  request,
}: {
  locale: "zh" | "en";
  request: (path: string, body?: unknown) => Promise<unknown>;
}) {
  const zh = locale === "zh";
  const [policy, setPolicy] = useState<z.infer<typeof learningPolicySchema>>(),
    [workspaces, setWorkspaces] = useState<{ id: string; name: string }[]>([]),
    [mode, setMode] = useState<"off" | "propose">("off"),
    [scopes, setScopes] = useState<string[]>([]),
    [consent, setConsent] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const alive = useRef(true),
    intent = useRef({ key: "", id: "" });
  async function load() {
    setBusy(true);
    setError("");
    try {
      const [raw, spaces] = await Promise.all([
        request("/learning/policy"),
        request("/workspaces"),
      ]);
      const current = learningPolicySchema.parse(raw),
        list = z
          .object({
            workspaces: z.array(z.object({ id: z.string(), name: z.string() })),
          })
          .parse(spaces);
      if (alive.current) {
        setPolicy(current);
        setMode(current.mode);
        setScopes(
          current.scopes.map((s) => (s.kind === "user" ? "user" : s.projectId)),
        );
        setWorkspaces(list.workspaces);
        setConsent(false);
      }
    } catch (e) {
      if (alive.current) setError(String(e));
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  useEffect(() => {
    alive.current = true;
    void load();
    return () => {
      alive.current = false;
    };
  }, [request]);
  async function save() {
    if (!policy) return;
    setBusy(true);
    setError("");
    try {
      const command = {
        expectedRevision: policy.revision,
        mode,
        scopes:
          mode === "off"
            ? []
            : scopes.map((id) =>
                id === "user"
                  ? { kind: "user" }
                  : { kind: "project", projectId: id },
              ),
        ...(mode === "propose" ? { consent: true } : {}),
      };
      const key = JSON.stringify(command);
      if (intent.current.key !== key)
        intent.current = { key, id: crypto.randomUUID() };
      const current = learningPolicySchema.parse(
        await request("/learning/policy", {
          ...command,
          requestId: intent.current.id,
        }),
      );
      if (alive.current) {
        setPolicy(current);
        setConsent(false);
        if (current.mode === "off") setScopes([]);
      }
    } catch (e) {
      if (alive.current) setError(String(e));
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  return (
    <section className="model-settings learning-settings">
      <p>
        {zh
          ? "學習政策只允許在指定範圍提出候選，不會自動發布技能或增加權限。每個來源工作仍須允許重用。"
          : "Learning policy permits proposals only within selected scopes. It never publishes skills or expands permissions. Each source work still requires reuse consent."}
      </p>
      <p>
        {zh
          ? "自動反思與評測佇列尚未接通；目前只保存同意政策。"
          : "Automatic reflection and evaluation queue are not connected yet; this currently saves consent policy only."}
      </p>
      <button disabled={busy} onClick={() => void load()}>
        {zh ? "重新載入政策（放棄草稿）" : "Reload policy (discard draft)"}
      </button>
      {error && <p role="alert">{error}</p>}
      {policy && (
        <p role="status">
          {zh ? "已保存政策" : "Saved policy"}: {policy.mode} · r
          {policy.revision}
        </p>
      )}
      <fieldset className="model-card" disabled={busy || !policy}>
        <label>
          {zh ? "Learning 模式" : "Learning mode"}
          <select
            value={mode}
            onChange={(e) => {
              setMode(e.target.value as "off" | "propose");
              setConsent(false);
            }}
          >
            <option value="off">off</option>
            <option value="propose">propose</option>
          </select>
        </label>
        {mode === "propose" && (
          <>
            <fieldset>
              <legend>
                {zh ? "允許提出候選的範圍" : "Scopes allowed for proposals"}
              </legend>
              {[
                {
                  id: "user",
                  name: zh
                    ? "個人範圍（不包含專案）"
                    : "User scope (excludes projects)",
                },
                ...workspaces,
              ].map((w) => (
                <label key={w.id}>
                  <input
                    type="checkbox"
                    checked={scopes.includes(w.id)}
                    onChange={(e) => {
                      setScopes((old) =>
                        e.target.checked
                          ? [...old, w.id]
                          : old.filter((id) => id !== w.id),
                      );
                      setConsent(false);
                    }}
                  />
                  {w.name}
                </label>
              ))}
            </fieldset>
            <label>
              <input
                type="checkbox"
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
              />
              {zh
                ? "我同意在以上範圍提出學習候選"
                : "I consent to Learning proposals in these scopes"}
            </label>
          </>
        )}
        <button
          disabled={mode === "propose" && (!consent || !scopes.length)}
          onClick={() => void save()}
        >
          {zh ? "保存學習政策" : "Save Learning policy"}
        </button>
      </fieldset>
      <LearningEpisodes locale={locale} request={request} />
    </section>
  );
}
