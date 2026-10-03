import { useEffect, useState } from "react";
import type { PresenceInput } from "./presence.js";
import { deriveRockyPresence } from "./presence.js";
const labels: Record<string, [string, string]> = {
  setup_required: ["先設定模型連線", "Set up a model connection"],
  idle: ["你想先處理哪件事？", "What would you like to work on?"],
  queued: ["已排入佇列", "Queued"],
  running: ["正在處理工作", "Working"],
  stale: ["尚未收到新的進度", "No recent progress received"],
  awaiting_approval: [
    "這個操作需要你的核准",
    "This operation needs your approval",
  ],
  completed: ["已完成；查看成果", "Completed; view results"],
  failed: ["工作失敗；查看詳情", "Work failed; inspect details"],
  blocked: ["操作結果需要確認", "Operation outcome needs reconciliation"],
  interrupted: ["工作已中斷", "Work interrupted"],
  cancelled: [
    "已停止；已發生的操作不會自動復原",
    "Stopped; completed effects are not automatically undone",
  ],
};
export function RockyPresence({
  works,
  events,
  connected,
  configured,
  locale,
}: {
  works: PresenceInput["works"];
  events: PresenceInput["events"];
  connected: boolean;
  configured: boolean;
  locale: "zh" | "en";
}) {
  const zh = locale === "zh";
  const [enabled, setEnabled] = useState(() => {
    try {
      return localStorage.getItem("rocky.animations") !== "off";
    } catch {
      return true;
    }
  });
  const [reduced, setReduced] = useState(
    () => matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  const [hidden, setHidden] = useState(document.hidden);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    const change = () => setReduced(media.matches);
    const visibility = () => {
      setHidden(document.hidden);
      setNow(Date.now());
    };
    media.addEventListener("change", change);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      media.removeEventListener("change", change);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, []);
  useEffect(() => {
    if (hidden) return;
    const timer = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(timer);
  }, [hidden]);
  const model = deriveRockyPresence(
    {
      works,
      events,
      connected,
      configured,
      animationsEnabled: enabled,
      reducedMotion: reduced,
      hidden,
    },
    now,
  );
  const count = model.counts;
  return (
    <div className="rocky-presence" data-presence={model.state}>
      <img
        className={"rocky-avatar" + (model.moving ? " presence-moving" : "")}
        src="/rocky/avatar.svg"
        width="50"
        height="50"
        alt="Rocky"
      />
      <h1>Rocky</h1>
      <p role="status">
        {!connected
          ? zh
            ? "連線中斷；下方為最後確認狀態 · "
            : "Disconnected; last confirmed state · "
          : ""}
        {(labels[model.state] ?? labels.idle)![zh ? 0 : 1]}
      </p>
      {Object.values(count).some(Boolean) && (
        <p>
          {zh ? "背景工作" : "Background work"}: {zh ? "執行" : "Running"}{" "}
          {count.running} · {zh ? "排隊" : "Queued"} {count.queued} ·{" "}
          {zh ? "待核准" : "Approval"} {count.approval} ·{" "}
          {zh ? "需處理" : "Attention"} {count.attention}
        </p>
      )}
      <button
        className="presence-motion"
        aria-pressed={enabled}
        onClick={() => {
          setEnabled(!enabled);
          try {
            localStorage.setItem("rocky.animations", enabled ? "off" : "on");
          } catch {
            /* Session preference remains available. */
          }
        }}
      >
        {zh ? "角色動畫" : "Character motion"}:{" "}
        {enabled ? (zh ? "開" : "On") : zh ? "關" : "Off"}
      </button>
    </div>
  );
}
