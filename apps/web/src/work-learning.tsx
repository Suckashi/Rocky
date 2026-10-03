import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import type { Work } from "../../../packages/contracts/src/index.js";
import { learningWorkConsentSchema } from "../../../packages/contracts/src/learning.js";
export function WorkLearning({
  work,
  locale,
  request,
}: {
  work: Work;
  locale: "zh" | "en";
  request: (path: string, body?: unknown) => Promise<unknown>;
}) {
  const zh = locale === "zh",
    alive = useRef(true),
    intent = useRef({ key: "", id: "" });
  const [open, setOpen] = useState(false),
    [value, setValue] = useState<z.infer<typeof learningWorkConsentSchema>>(),
    [privateSource, setPrivate] = useState(false),
    [excluded, setExcluded] = useState(true),
    [reuse, setReuse] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  function adopt(next: z.infer<typeof learningWorkConsentSchema>) {
    setValue(next);
    setPrivate(next.private);
    setExcluded(next.excluded);
    setReuse(next.sourceReuseAllowed);
  }
  async function load() {
    setBusy(true);
    setError("");
    try {
      const next = learningWorkConsentSchema.parse(
        await request(`/works/${work.id}/learning-consent`),
      );
      if (alive.current) adopt(next);
    } catch (e) {
      if (alive.current) setError(String(e));
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  async function save() {
    if (!value) return;
    setBusy(true);
    setError("");
    try {
      const command = {
        expectedRevision: value.revision,
        private: privateSource,
        excluded,
        sourceReuseAllowed: reuse,
      };
      const key = JSON.stringify([work.id, command]);
      if (intent.current.key !== key)
        intent.current = { key, id: crypto.randomUUID() };
      const next = learningWorkConsentSchema.parse(
        await request(`/works/${work.id}/learning-consent`, {
          ...command,
          requestId: intent.current.id,
        }),
      );
      if (alive.current) adopt(next);
    } catch (e) {
      if (alive.current) setError(String(e));
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  return (
    <details
      className="work-learning"
      open={open}
      onToggle={(e) => {
        const expanded = e.currentTarget.open;
        setOpen(expanded);
        if (expanded && !value && !busy) void load();
      }}
    >
      <summary>
        {zh ? "此工作的學習權限" : "Learning permissions for this work"}
      </summary>
      <p>
        {zh
          ? "只控制此工作能否作為 Learning 來源，不會更改工具權限，也不會立即開始反思。"
          : "Controls whether this work may be a Learning source. It does not change tool permissions or start reflection."}
      </p>
      <p>
        {zh
          ? "標記私人、排除學習或取消來源重用，會移除既有 episode 的摘要與證據清單；重新允許不會恢復它們。"
          : "Marking private, excluding Learning or withdrawing reuse removes existing episode summaries and evidence lists. Allowing again does not restore them."}
      </p>
      {work.runMode !== "normal" && (
        <p>
          {zh
            ? "此工作模式不能作為學習來源。"
            : "This work mode cannot be a Learning source."}
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      {value && (
        <p role="status">
          {zh ? "已保存" : "Saved"} · r{value.revision} ·{" "}
          {value.private || value.excluded || !value.sourceReuseAllowed
            ? zh
              ? "排除學習"
              : "Excluded from Learning"
            : zh
              ? "允許來源審查，尚非學習成果"
              : "Source review allowed, not a Learning result"}
        </p>
      )}
      <button disabled={busy} onClick={() => void load()}>
        {zh ? "重新載入權限（放棄草稿）" : "Reload permissions (discard draft)"}
      </button>
      <fieldset disabled={busy || !value} className="model-card">
        <label>
          <input
            type="checkbox"
            checked={privateSource}
            onChange={(e) => setPrivate(e.target.checked)}
          />
          {zh
            ? "私人來源，不用於學習"
            : "Private source, exclude from Learning"}
        </label>
        <label>
          <input
            type="checkbox"
            checked={excluded}
            onChange={(e) => setExcluded(e.target.checked)}
          />
          {zh ? "排除此工作學習" : "Exclude this work from Learning"}
        </label>
        <label>
          <input
            type="checkbox"
            checked={reuse}
            onChange={(e) => setReuse(e.target.checked)}
          />
          {zh ? "我確認來源條款允許重用" : "I confirm source terms allow reuse"}
        </label>
        <button onClick={() => void save()}>
          {zh ? "保存此工作學習權限" : "Save work Learning permissions"}
        </button>
      </fieldset>
    </details>
  );
}
