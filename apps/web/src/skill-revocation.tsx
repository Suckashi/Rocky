import type {
  PublicEvent,
  Work,
} from "../../../packages/contracts/src/index.js";

export function SkillRevocation({
  work,
  events,
  locale,
}: {
  work: Work;
  events: PublicEvent[];
  locale: "zh" | "en";
}) {
  const revoked = events.filter(
    (event) =>
      event.payload.kind === "domain" &&
      event.payload.name === "rocky.skill.revoked" &&
      event.workId === work.id &&
      event.runId === work.runId,
  );
  if (!revoked.length) return null;
  const zh = locale === "zh";
  return (
    <section
      className="approval skill-revocation"
      aria-label={zh ? "技能撤銷通知" : "Skill revocation notice"}
    >
      <p role="status">
        <strong>
          {zh
            ? "此工作使用目錄中的技能已被隔離"
            : "A skill in this work’s catalog was quarantined"}
        </strong>
      </p>
      <p>
        {zh
          ? "擁有者已撤銷此版本。後續讀取會被拒絕；若工作已載入該技能，後續工具操作及新核准也會被拒絕。你仍可拒絕待核准操作或停止工作。"
          : "The owner revoked this version. Further reads are denied. If already loaded, subsequent tool operations and new approvals are also denied. You can still reject a pending operation or stop the work."}
      </p>
      <p>
        {zh
          ? "已發生的操作與已傳送的內容不會因此復原。工作結果仍以實際狀態為準。"
          : "This does not undo prior operations or content already delivered. The actual work status remains authoritative."}
      </p>
      <details>
        <summary>{zh ? "撤銷證據" : "Revocation evidence"}</summary>
        {revoked.map((event) => (
          <p key={event.id}>
            <code>
              {String(
                event.payload.kind === "domain"
                  ? event.payload.data.skillId
                  : "",
              )}
            </code>{" "}
            · r
            {String(
              event.payload.kind === "domain"
                ? event.payload.data.skillRevision
                : "",
            )}
            <br />
            SHA-256:{" "}
            <code>
              {String(
                event.payload.kind === "domain"
                  ? event.payload.data.contentHash
                  : "",
              )}
            </code>
          </p>
        ))}
      </details>
    </section>
  );
}
