import ReactMarkdown from "react-markdown";
import type { Work } from "../../../packages/contracts/src/index.js";
import type { Artifact } from "../../../packages/contracts/src/artifacts.js";
import type { PublicEvent } from "../../../packages/contracts/src/index.js";
import { AttachmentLinks } from "./attachments.js";
import { SkillRevocation } from "./skill-revocation.js";
import { ToolActivity } from "./tool-activity.js";
import { WorkArtifacts } from "./work-artifacts.js";
import { WorkGrants } from "./work-grants.js";
import { WorkLearning } from "./work-learning.js";
import { WorkSteering } from "./work-steering.js";
import { WorkRetry } from "./work-retry.js";
import { WorkOperations } from "./work-operations.js";
import { WorkUsage } from "./work-usage.js";
import { ApprovalCard } from "./approval-card.js";
import { labels, type Locale } from "./i18n.js";

/** One Work in the conversation: request, approval, answer, results and details. */
export function WorkCard({
  w,
  locale,
  request,
  events,
  stream,
  artifacts,
  connected,
  decide,
  stop,
  onOpenArtifact,
}: {
  w: Work;
  locale: Locale;
  request: (path: string, body?: unknown) => Promise<unknown>;
  events: PublicEvent[];
  stream?: string;
  artifacts: Artifact[];
  connected: boolean;
  decide: (work: Work, decision: "approve" | "reject") => void;
  stop: (work: Work) => void;
  onOpenArtifact: (artifact: Artifact) => void;
}) {
  const t = labels[locale];
  return (
    <article
      className="work"
      key={w.id}
      id={"work-" + w.id}
      tabIndex={-1}
      aria-label={w.text}
    >
      <div className="work-heading">
        <strong>{w.text}</strong>
        <span className={"status " + w.status}>
          {w.status === "queued" && w.waitingFor
            ? w.waitingFor === "workspace"
              ? locale === "zh"
                ? "等待工作區可用"
                : "Waiting for workspace availability"
              : locale === "zh"
                ? "等待執行名額"
                : "Waiting for an execution slot"
            : t.status[w.status]}
        </span>
      </div>
      {w.retryOf && (
        <small>
          {locale === "zh"
            ? "重試工作 · 新的執行"
            : "Retry work · new execution"}
        </small>
      )}
      <SkillRevocation work={w} events={events} locale={locale} />
      <ToolActivity work={w} events={events} locale={locale} />
      {w.approval?.status === "pending" && (
        <ApprovalCard
          w={{ ...w, approval: w.approval }}
          locale={locale}
          request={request}
          decide={decide}
        />
      )}
      {(w.answer || (w.status === "running" && stream)) && (
        <div className="answer">
          {!w.answer && (
            <small className="stream-label">
              {locale === "zh"
                ? "回覆片段 · 工作尚未完成"
                : "Response fragment · work is not complete"}
            </small>
          )}
          <ReactMarkdown
            components={{
              img: ({ alt }) => <span>{alt}</span>,
              a: ({ children, href }) => (
                <a href={href} target="_blank" rel="noreferrer">
                  {children}
                </a>
              ),
            }}
          >
            {w.answer || stream || ""}
          </ReactMarkdown>
        </div>
      )}
      <WorkArtifacts
        items={artifacts}
        locale={locale}
        onOpen={onOpenArtifact}
      />
      {w.error && <p role="alert">{w.error}</p>}
      <details>
        <summary>{t.detail}</summary>
        <WorkGrants work={w} locale={locale} request={request} />
        <AttachmentLinks refs={w.attachments} />
        <WorkLearning
          work={w}
          events={events}
          locale={locale}
          request={request}
        />
        <WorkSteering
          work={w}
          events={events}
          locale={locale}
          connected={connected}
          request={request}
        />
        <WorkRetry
          work={w}
          events={events}
          locale={locale}
          connected={connected}
          request={request}
        />
        <WorkOperations
          workId={w.id}
          revision={
            events.findLast(
              (e) =>
                e.workId === w.id &&
                e.payload.kind === "domain" &&
                e.payload.name.startsWith("rocky.operation."),
            )?.sequence ?? "0"
          }
          locale={locale}
          request={request}
        />
        <p>
          {locale === "zh"
            ? "此工作模型呼叫上限"
            : "Model call limit for this work"}
          : {w.modelBudget?.maxCalls ?? 48}
        </p>
        <WorkUsage
          workId={w.id}
          revision={
            events.findLast(
              (event) =>
                event.workId === w.id &&
                event.payload.kind === "domain" &&
                event.payload.name === "rocky.model.completed",
            )?.sequence ?? String(w.revision)
          }
          locale={locale}
          request={request}
        />
        <ol>
          {events
            .filter(
              (e) =>
                e.workId === w.id &&
                e.payload.kind === "domain" &&
                e.payload.name !== "rocky.work.updated",
            )
            .map((e) => (
              <li key={e.id}>
                <span>
                  {e.payload.kind === "domain"
                    ? e.payload.name.replace("rocky.", "")
                    : e.payload.event.type}
                </span>{" "}
                <small>
                  {e.payload.kind === "domain"
                    ? String(e.payload.data.name ?? "")
                    : ""}
                </small>
                <details>
                  <summary>Evidence</summary>
                  <pre>{JSON.stringify(e.payload, null, 2)}</pre>
                </details>
              </li>
            ))}
        </ol>
      </details>
      {["queued", "running", "waiting_approval"].includes(w.status) && (
        <button className="stop" onClick={() => stop(w)}>
          {t.stop}
        </button>
      )}
    </article>
  );
}
