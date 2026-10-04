import { useCallback, useEffect, useMemo, useState, useRef } from "react";
import {
  API_PREFIX,
  publicEventSchema,
  snapshotSchema,
  workSchema,
  type Work,
  type PublicEvent,
} from "../../../packages/contracts/src/index.js";
import {
  projectCompletion,
  type CompletionFeedback,
} from "./presence-feedback.js";
import { projectEvidence, projectWork } from "./projection.js";
import {
  conversationPageSchema,
  conversationMessageSchema,
} from "../../../packages/contracts/src/conversation.js";
import { z } from "zod";
import {
  artifactSchema,
  type Artifact,
} from "../../../packages/contracts/src/artifacts.js";
const historyReferenceSchema = conversationMessageSchema.pick({
  id: true,
  sequence: true,
  workId: true,
});
type HistoryMessage = z.infer<typeof historyReferenceSchema>;
function mergeHistory(old: HistoryMessage[], incoming: HistoryMessage[]) {
  const messages = new Map(old.map((message) => [message.id, message]));
  for (const message of incoming) messages.set(message.id, message);
  return [...messages.values()].sort((a, b) =>
    BigInt(a.sequence) < BigInt(b.sequence)
      ? -1
      : BigInt(a.sequence) > BigInt(b.sequence)
        ? 1
        : 0,
  );
}

export type RockyRequest = (path: string, body?: unknown) => Promise<unknown>;

function mergeWorks(old: Work[], incoming: Work[]) {
  const works = new Map(old.map((work) => [work.id, work]));
  for (const work of incoming) {
    if ((works.get(work.id)?.revision ?? 0) < work.revision)
      works.set(work.id, work);
  }
  return [...works.values()].sort((a, b) =>
    a.createdAt.localeCompare(b.createdAt),
  );
}
async function historyWorks(request: RockyRequest, messages: HistoryMessage[]) {
  const ids = [...new Set(messages.map((message) => message.workId))];
  if (!ids.length) return [];
  return z
    .object({ works: z.array(workSchema) })
    .parse(await request("/works?ids=" + ids.join(","))).works;
}

// One snapshot/event owner for every view. Cards never establish event sources.
// Transport closure only changes connection state, never Work outcomes.
export function useRockyProjection(request: RockyRequest) {
  const [completion, setCompletion] = useState<CompletionFeedback>();
  const [lastConfirmedAt, setLastConfirmedAt] = useState<string>();
  const completionWatermark = useRef("0");
  const completedRuns = useRef(new Set<string>());
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [artifactError, setArtifactError] = useState("");
  const [artifactLoading, setArtifactLoading] = useState(true);
  const [artifactAttempt, setArtifactAttempt] = useState(0);
  const reloadArtifacts = useCallback(
    () => setArtifactAttempt((old) => old + 1),
    [],
  );
  const [works, setWorks] = useState<Work[]>([]);
  const [events, setEvents] = useState<PublicEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const [connectionError, setConnectionError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [history, setHistory] = useState<HistoryMessage[]>([]);
  const [historyCursor, setHistoryCursor] = useState<string | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const generation = useRef(0);
  const loadEarlier = useCallback(async () => {
    if (!historyCursor || historyLoading) return;
    setHistoryLoading(true);
    setHistoryError("");
    const owner = generation.current;
    try {
      const page = conversationPageSchema.parse(
        await request("/conversation/history?before=" + historyCursor),
      );
      const pageWorks = await historyWorks(request, page.messages);
      if (owner !== generation.current) return;
      setWorks((old) => mergeWorks(old, pageWorks));
      setHistory((old) => mergeHistory(old, page.messages));
      setHistoryCursor(page.nextCursor);
    } catch (error) {
      if (owner !== generation.current) return;
      setHistoryError(error instanceof Error ? error.message : String(error));
    } finally {
      if (owner === generation.current) setHistoryLoading(false);
    }
  }, [request, historyCursor, historyLoading]);
  const reconnect = useCallback(() => setAttempt((old) => old + 1), []);
  useEffect(() => {
    let active = true;
    setArtifactLoading(true);
    setArtifactError("");
    void request("/artifacts")
      .then((value) => {
        const incoming = z
          .object({ artifacts: z.array(artifactSchema) })
          .parse(value).artifacts;
        if (active)
          setArtifacts((old) => [
            ...new Map(
              [...incoming, ...old].map((item) => [item.id, item]),
            ).values(),
          ]);
      })
      .catch((error) => {
        if (active)
          setArtifactError(
            error instanceof Error ? error.message : String(error),
          );
      })
      .finally(() => {
        if (active) setArtifactLoading(false);
      });
    return () => {
      active = false;
    };
  }, [request, attempt, artifactAttempt]);
  useEffect(() => {
    generation.current++;
    setHistoryLoading(false);
    let disposed = false;
    let stream: EventSource | undefined;
    const offline = () => {
      setConnected(false);
      stream?.close();
    };
    const online = () => setAttempt((old) => old + 1);
    window.addEventListener("offline", offline);
    window.addEventListener("online", online);
    setConnected(false);
    void request("/snapshot")
      .then(async (data) => {
        if (disposed) return;
        const snapshot = snapshotSchema.parse(data);
        completionWatermark.current = snapshot.cursor;
        for (const work of snapshot.works)
          if (work.status === "completed")
            completedRuns.current.add(work.runId);
        setCompletion(undefined);
        setLastConfirmedAt(new Date().toISOString());
        setWorks(snapshot.works);
        setEvents(snapshot.events);
        const page = conversationPageSchema.parse(
          await request("/conversation/history"),
        );
        const pageWorks = await historyWorks(request, page.messages);
        if (disposed) return;
        setWorks((old) => mergeWorks(old, pageWorks));
        setHistory((old) => mergeHistory(old, page.messages));
        setHistoryCursor(page.nextCursor);
        setHistoryError("");
        setConnectionError("");
        if (!navigator.onLine) return;
        stream = new EventSource(
          API_PREFIX + "/events?after=" + snapshot.cursor,
        );
        stream.onopen = () => {
          if (!disposed) setConnected(navigator.onLine);
        };
        stream.onerror = () => {
          if (!disposed) setConnected(false);
        };
        stream.addEventListener("daemon_degraded", () => {
          if (disposed) return;
          setConnected(false);
          setConnectionError(
            "執行儲存或清理失敗；狀態可能尚未同步。請修復儲存問題並重啟 daemon，再確認操作結果。 / Execution storage or cleanup failed. Restart the daemon after repair, then reconcile operation outcomes.",
          );
          stream?.close();
        });
        stream.onmessage = (message) => {
          if (disposed) return;
          try {
            const event = publicEventSchema.parse(JSON.parse(message.data));
            const feedback = projectCompletion(
              event,
              completionWatermark.current,
              Date.now(),
              completedRuns.current,
            );
            completionWatermark.current = feedback.watermark;
            if (feedback.completion) {
              if (event.runId) completedRuns.current.add(event.runId);
              setCompletion(feedback.completion);
            }
            setLastConfirmedAt(new Date().toISOString());
            setEvents((old) => projectEvidence(old, event));
            setWorks((old) => projectWork(old, event));
            if (
              event.payload.kind === "domain" &&
              event.payload.name === "rocky.artifact.published"
            ) {
              const artifact = artifactSchema.parse(
                event.payload.data.artifact,
              );
              setArtifacts((old) => [
                artifact,
                ...old.filter((a) => a.id !== artifact.id),
              ]);
            }
            if (
              event.payload.kind === "domain" &&
              event.payload.name === "rocky.work.updated" &&
              event.payload.data.historyRefs !== undefined
            ) {
              const records = historyReferenceSchema
                .array()
                .parse(event.payload.data.historyRefs);
              setHistory((old) => mergeHistory(old, records));
            }
          } catch {
            setConnected(false);
            setConnectionError(
              "Invalid server event; reconnect to resynchronize.",
            );
            stream?.close();
          }
        };
      })
      .catch((error) => {
        if (!disposed)
          setConnectionError(
            error instanceof Error ? error.message : String(error),
          );
      });
    return () => {
      generation.current++;
      disposed = true;
      window.removeEventListener("offline", offline);
      window.removeEventListener("online", online);
      stream?.close();
    };
  }, [request, attempt]);
  const streams = useMemo(() => {
    const result: Record<string, { requestId: string; text: string }> = {};
    for (const event of events) {
      if (
        !event.workId ||
        event.payload.kind !== "domain" ||
        event.payload.name !== "rocky.model.stream"
      )
        continue;
      const { requestId, phase, delta } = event.payload.data;
      if (typeof requestId !== "string") continue;
      const previous = result[event.workId];
      if (phase === "start" || previous?.requestId !== requestId)
        result[event.workId] = { requestId, text: "" };
      if (phase === "delta" && typeof delta === "string")
        result[event.workId]!.text += delta;
    }
    return result;
  }, [events]);
  const visibleWorks = useMemo(() => {
    const visible = new Set(history.map((message) => message.workId));
    return works.filter(
      (work) =>
        work.runMode === "normal" &&
        (visible.has(work.id) ||
          ["queued", "running", "waiting_approval"].includes(work.status)),
    );
  }, [works, history]);
  return {
    works: visibleWorks,
    presenceWorks: works,
    completion,
    lastConfirmedAt,
    artifacts,
    artifactError,
    artifactLoading,
    reloadArtifacts,
    events,
    streams,
    connected,
    connectionError,
    reconnect,
    historyCursor,
    historyLoading,
    historyError,
    loadEarlier,
  };
}

export function workCommands(request: RockyRequest) {
  return {
    decide: (work: Work, decision: "approve" | "reject") => {
      if (!work.approval || work.approval.status !== "pending")
        throw Error("No pending approval");
      return request(`/approvals/${work.approval.id}/decision`, {
        requestId: crypto.randomUUID(),
        expectedRevision: work.approval.revision,
        intentFingerprint: work.approval.intentFingerprint,
        decision,
      });
    },
    stop: (work: Work) =>
      request(`/works/${work.id}/stop`, {
        requestId: crypto.randomUUID(),
        runId: work.runId,
        executionSessionId: work.executionSessionId,
        expectedRevision: work.revision,
      }),
  };
}
