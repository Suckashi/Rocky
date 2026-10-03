import { useCallback, useEffect, useMemo, useState } from "react";
import {
  API_PREFIX,
  publicEventSchema,
  snapshotSchema,
  type Work,
  type PublicEvent,
} from "../../../packages/contracts/src/index.js";
import { projectEvidence, projectWork } from "./projection.js";

export type RockyRequest = (path: string, body?: unknown) => Promise<unknown>;

// One snapshot/event owner for every view. Cards never establish event sources.
// Transport closure only changes connection state, never Work outcomes.
export function useRockyProjection(request: RockyRequest) {
  const [works, setWorks] = useState<Work[]>([]);
  const [events, setEvents] = useState<PublicEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const [connectionError, setConnectionError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const reconnect = useCallback(() => setAttempt((old) => old + 1), []);
  useEffect(() => {
    let disposed = false;
    let stream: EventSource | undefined;
    setConnected(false);
    void request("/snapshot")
      .then((data) => {
        if (disposed) return;
        const snapshot = snapshotSchema.parse(data);
        setWorks(snapshot.works);
        setEvents(snapshot.events);
        setConnectionError("");
        stream = new EventSource(
          API_PREFIX + "/events?after=" + snapshot.cursor,
        );
        stream.onopen = () => {
          if (!disposed) setConnected(true);
        };
        stream.onerror = () => {
          if (!disposed) setConnected(false);
        };
        stream.onmessage = (message) => {
          if (disposed) return;
          try {
            const event = publicEventSchema.parse(JSON.parse(message.data));
            setEvents((old) => projectEvidence(old, event));
            setWorks((old) => projectWork(old, event));
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
      disposed = true;
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
  return { works, events, streams, connected, connectionError, reconnect };
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
