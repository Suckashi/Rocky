import { ChevronRight, FileText, GitBranch, Wrench } from "lucide-react";
import type {
  PublicEvent,
  Work,
} from "../../../packages/contracts/src/index.js";
export function ToolActivity({
  work,
  events,
  locale,
}: {
  work: Work;
  events: PublicEvent[];
  locale: "zh" | "en";
}) {
  const zh = locale === "zh";
  const calls = new Map<
    string,
    {
      name: string;
      child: boolean;
      subagent: boolean;
      state: string;
      target: string;
      events: PublicEvent[];
    }
  >();
  for (const event of events) {
    if (
      event.workId !== work.id ||
      event.runId !== work.runId ||
      event.executionSessionId !== work.executionSessionId ||
      event.payload.kind !== "domain"
    )
      continue;
    const match = /^rocky\.(tool|subagent)\.(started|completed|failed)$/.exec(
        event.payload.name,
      ),
      data = event.payload.data;
    if (
      !match ||
      typeof data.callId !== "string" ||
      typeof data.name !== "string"
    )
      continue;
    const key = JSON.stringify([
      event.subagentId ?? null,
      data.child === true,
      data.callId,
    ]);
    const old = calls.get(key);
    const args =
      data.args && typeof data.args === "object"
        ? (data.args as Record<string, unknown>)
        : {};
    const target = [
      args.file_path,
      args.path,
      args.toolName,
      args.description,
    ].find((v) => typeof v === "string") as string | undefined;
    calls.set(key, {
      name: data.name,
      child: data.child === true,
      subagent: match[1] === "subagent",
      state: match[2]!,
      target: old?.target ?? target ?? "",
      events: [...(old?.events ?? []), event],
    });
  }
  return (
    <>
      {[...calls].map(([key, call]) => {
        const pending = call.state === "started",
          active = ["running", "queued", "waiting_approval"].includes(
            work.status,
          );
        const state =
          call.state === "completed"
            ? zh
              ? "已返回"
              : "Returned"
            : call.state === "failed"
              ? zh
                ? "失敗"
                : "Failed"
              : pending && active
                ? zh
                  ? "執行中"
                  : "Running"
                : zh
                  ? "結果未確認"
                  : "Result unconfirmed";
        const Icon = call.subagent
          ? GitBranch
          : call.name.includes("file")
            ? FileText
            : Wrench;
        const label =
          (
            {
              read_file: zh ? "讀取檔案" : "Reading file",
              write_file: zh ? "寫入檔案" : "Writing file",
              task: zh ? "子工作" : "Subtask",
              write_todos: zh ? "更新工作步驟" : "Updating steps",
              mcp_call: zh ? "使用已配置工具" : "Using configured tool",
            } as Record<string, string>
          )[call.name] ?? call.name;
        return (
          <details className="inline-tool" key={key} aria-label={label}>
            <summary
              aria-label={`${label}: ${state}; ${zh ? "展開工具證據" : "Expand tool evidence"}`}
            >
              <header>
                <Icon size={16} aria-hidden="true" />
                <strong>{label}</strong>
                <span
                  className={
                    call.state === "failed" ? "tool-state failed" : "tool-state"
                  }
                >
                  {state}
                </span>
                <ChevronRight
                  className="tool-chevron"
                  size={16}
                  aria-hidden="true"
                />
              </header>
              {call.target && (
                <div className="inline-tool-detail" title={call.target}>
                  {call.target}
                </div>
              )}
            </summary>
            <div className="inline-tool-evidence">
              <p>
                {zh
                  ? "工具返回不代表外部操作已成功；副作用以工作收據為準。"
                  : "Tool return is not proof of an external effect; inspect the Work receipt."}
              </p>
              {call.child && (
                <p>{zh ? "由原生子工作執行" : "Executed by a native child"}</p>
              )}
              <details>
                <summary>
                  {zh ? "原始事件與識別" : "Raw events and identifiers"}
                </summary>
                <pre>{JSON.stringify(call.events, null, 2)}</pre>
              </details>
            </div>
          </details>
        );
      })}
    </>
  );
}
