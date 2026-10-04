import { useEffect, useState } from "react";
import { RokoSprite } from "./roko-sprite.js";
import { completionDuration, rokoPlayback } from "./roko-animation.js";
import type { CompletionFeedback } from "./presence-feedback.js";
import type { PresenceInput } from "./presence.js";
import { deriveRockyPresence } from "./presence.js";
// Transport already deduplicates stable event/run IDs and suppresses snapshots.
// This additionally survives presentation remounts, without retaining old records.
const consumedCompletions = new WeakSet<CompletionFeedback>();
const labels: Record<string, [string, string]> = {
  setup_required: ["先設定模型連線", "Set up a model connection"],
  idle: ["你想先處理哪件事？", "What would you like to work on?"],
  queued: ["已排入佇列", "Queued"],
  waiting_resource: ["等待工作區可用", "Waiting for workspace availability"],
  waiting_model: ["等待模型資源可用", "Waiting for model capacity"],
  running: ["正在處理工作", "Working"],
  model: ["等待模型回應", "Waiting for model response"],
  tool: ["正在執行工具", "Running a tool"],
  read: ["正在讀取檔案", "Reading files"],
  review: ["正在檢查變更", "Reviewing changes"],
  subagent: ["子工作正在執行", "Subtask running"],
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
  completion,
  lastConfirmedAt,
  onOpenWork,
}: {
  onOpenWork: (id: string) => void;
  completion?: CompletionFeedback;
  lastConfirmedAt?: string;
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
  const [celebrating, setCelebrating] = useState(false);
  useEffect(() => {
    setCelebrating(false);
    if (!completion || consumedCompletions.has(completion)) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Defer claiming until after StrictMode's setup/cleanup probe.
    queueMicrotask(() => {
      if (disposed || consumedCompletions.has(completion)) return;
      consumedCompletions.add(completion);
      if (
        !connected ||
        !enabled ||
        reduced ||
        hidden ||
        model.state !== "completed" ||
        model.foregroundId !== completion.workId ||
        Date.now() - completion.receivedAt > 1000
      )
        return;
      setCelebrating(true);
      timer = setTimeout(() => setCelebrating(false), completionDuration);
    });
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [
    completion,
    connected,
    enabled,
    reduced,
    hidden,
    model.state,
    model.foregroundId,
  ]);
  const count = model.counts;
  const playback = rokoPlayback(model, celebrating);
  return (
    <div className="rocky-presence" data-presence={model.state}>
      <RokoSprite
        {...playback}
        className="rocky-avatar"
        playbackId={celebrating ? completion?.id : undefined}
      />
      <h1>Rocky</h1>
      <p role="status">
        {!connected
          ? zh
            ? "連線中斷；下方為最後確認狀態 · "
            : "Disconnected; last confirmed state · "
          : ""}
        {
          (labels[
            model.state === "running" && model.activity
              ? model.activity
              : model.state
          ] ?? labels.idle)![zh ? 0 : 1]
        }
      </p>
      {!connected && lastConfirmedAt && (
        <p>
          {zh ? "最後確認同步" : "Last confirmed sync"}:{" "}
          <time dateTime={lastConfirmedAt}>
            {new Date(lastConfirmedAt).toLocaleTimeString(
              zh ? "zh-TW" : "en-US",
            )}
          </time>
        </p>
      )}
      {Object.values(count).some(Boolean) && (
        <details className="presence-background">
          <summary>
            {zh ? "背景工作" : "Background work"}: {zh ? "執行" : "Running"}{" "}
            {count.running} · {zh ? "排隊" : "Queued"} {count.queued} ·{" "}
            {zh ? "待核准" : "Approval"} {count.approval} ·{" "}
            {zh ? "需處理" : "Attention"} {count.attention}
          </summary>
          <ul>
            {works
              .filter(
                (work) =>
                  work.runMode === "normal" &&
                  work.kind === "background" &&
                  [
                    "running",
                    "queued",
                    "waiting_approval",
                    "failed",
                    "interrupted",
                    "blocked",
                  ].includes(work.status),
              )
              .map((work) => (
                <li key={work.id}>
                  <button
                    onClick={(event) => {
                      event.currentTarget
                        .closest("details")
                        ?.removeAttribute("open");
                      onOpenWork(work.id);
                    }}
                  >
                    <span>{work.text}</span>
                    <small>
                      {
                        (labels[
                          work.status === "queued" &&
                          work.waitingFor === "workspace"
                            ? "waiting_resource"
                            : work.status === "waiting_approval"
                              ? "awaiting_approval"
                              : work.status
                        ] ?? labels.idle)![zh ? 0 : 1]
                      }
                    </small>
                  </button>
                </li>
              ))}
          </ul>
        </details>
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
