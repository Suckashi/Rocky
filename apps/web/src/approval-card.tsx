import type { Work } from "../../../packages/contracts/src/index.js";
import { MemoryProposal } from "./memory-proposal.js";
import { WriteProposal } from "./write-proposal.js";
import { labels, type Locale } from "./i18n.js";

/** Pending approval for one Work: exact effect, arguments and approve/reject decision. */
export function ApprovalCard({
  w,
  locale,
  request,
  decide,
}: {
  w: Work & { approval: NonNullable<Work["approval"]> };
  locale: Locale;
  request: (path: string, body?: unknown) => Promise<unknown>;
  decide: (work: Work, decision: "approve" | "reject") => void;
}) {
  const t = labels[locale];
  return (
    <section className="approval">
      <h2>{t.approval}</h2>
      <p>
        {w.approval.tool === "memory_write"
          ? locale === "zh"
            ? "這將建立或更新本地記憶，並保留未驗證狀態。人工鎖定的記憶不可由模型覆寫。"
            : "This creates or updates local memory as unverified. Models cannot overwrite owner-locked memory."
          : ["mcp_call", "mcp_data"].includes(w.approval.tool)
            ? locale === "zh"
              ? "這將呼叫你配置的外部 MCP 伺服器，可能改變外部資料。"
              : "This calls your configured MCP server and may change external data."
            : w.approval.tool === "workspace_write"
              ? locale === "zh"
                ? "這將在選定工作區建立或完整取代一個檔案。"
                : "This creates or fully replaces one file in the selected workspace."
              : w.approval.tool === "workspace_command"
                ? locale === "zh"
                  ? "這會以你的本機 OS 權限，在選定工作區執行精確命令；沒有檔案或網路隔離。執行結果可能改變工作區以外的資料。"
                  : "This runs the exact command with your local OS permissions in the selected workspace. There is no filesystem or network isolation; it may affect data outside the workspace."
                : w.approval.tool === "workspace_worktree"
                  ? locale === "zh"
                    ? "這將建立本地 Git 分支與獨立工作區，並修改來源 repository 的 Git 登記。"
                    : "This creates a local Git branch and worktree and updates the source repository Git registration."
                  : t.impact}
      </p>
      {w.approval.tool === "memory_write" ? (
        <>
          <p>
            {locale === "zh" ? "範圍：" : "Scope: "}
            {
              (
                {
                  user: locale === "zh" ? "個人" : "User",
                  project: locale === "zh" ? "專案" : "Project",
                  task: locale === "zh" ? "此工作" : "This Work",
                } as Record<string, string>
              )[String(w.approval.args.scope)]
            }{" "}
            ·{" "}
            {w.approval.args.private !== false
              ? locale === "zh"
                ? "私密"
                : "Private"
              : locale === "zh"
                ? "非私密"
                : "Not private"}{" "}
            · r{Number(w.approval.args.expectedRevision)} → r
            {Number(w.approval.args.expectedRevision) + 1}
          </p>
          <div className="memory-content approval-proposal">
            {String(w.approval.args.content)}
          </div>
          <MemoryProposal
            key={w.approval.id + ":" + w.approval.revision}
            approval={w.approval}
            locale={locale}
            request={request}
          />
        </>
      ) : w.approval.tool === "document_write" ? (
        <>
          <p>
            {locale === "zh"
              ? "核准將保存完整內容為新文件版本，不會改動原始成果。"
              : "Approval saves the complete content as a new document revision without changing source artifacts."}
          </p>
          <p>
            {String(w.approval.args.title)} · r
            {Number(w.approval.args.expectedRevision)} → r
            {Number(w.approval.args.expectedRevision) + 1}
          </p>
          <code>{String(w.approval.args.id)}</code>
          <pre className="approval-proposal" tabIndex={0}>
            {String(w.approval.args.content)}
          </pre>
        </>
      ) : ["mcp_call", "mcp_data"].includes(w.approval.tool) ? (
        <>
          <p>
            <strong>
              {String(
                w.approval.tool === "mcp_data"
                  ? (
                      w.approval.args.target as {
                        kind?: string;
                      }
                    )?.kind === "prompt"
                    ? locale === "zh"
                      ? "取得 MCP prompt"
                      : "Get MCP prompt"
                    : locale === "zh"
                      ? "讀取 MCP 資源"
                      : "Read MCP resource"
                  : w.approval.args.toolName,
              )}
            </strong>{" "}
            · {String(w.approval.args.serverId)}
          </p>
          {w.approval.tool === "mcp_data" && (
            <p>
              <code>
                {String(
                  w.approval.targetPreview ??
                    (w.approval.args.target as Record<string, unknown>)?.uri ??
                    (w.approval.args.target as Record<string, unknown>)
                      ?.uriTemplate ??
                    (w.approval.args.target as Record<string, unknown>)?.name ??
                    "",
                )}
              </code>
            </p>
          )}
          <p>
            {locale === "zh"
              ? "外部工具的效果尚未確認。核准只適用這次顯示的精確參數；拒絕不會送出呼叫。"
              : "External effects are unconfirmed. Approval applies only to these exact arguments; rejection sends no call."}
          </p>
          <details>
            <summary>
              {locale === "zh" ? "檢查待執行參數" : "Review exact arguments"}
            </summary>
            <pre>
              {JSON.stringify(
                w.approval.args.arguments ?? w.approval.args.target,
                null,
                2,
              )}
            </pre>
          </details>
        </>
      ) : w.approval.tool === "workspace_worktree" &&
        w.approval.worktreePreview ? (
        <>
          <p>
            {w.approval.worktreePreview.isolation === "directory"
              ? locale === "zh"
                ? "建立全新空資料夾；不複製來源檔案，也不建立 Git 分支。"
                : "Creates a new empty directory; no source files or Git branch are copied."
              : locale === "zh"
                ? "只複製已提交的 HEAD；未提交與未追蹤檔案不會帶入。"
                : "Checks out committed HEAD only; excludes dirty and untracked files."}
          </p>
          <p>
            {w.approval.worktreePreview.useForCurrentWork
              ? locale === "zh"
                ? "核准後，此 Work 將切換到新工作區。"
                : "Approval also switches this Work to the new workspace."
              : locale === "zh"
                ? "此 Work 不會切換；新工作區供之後的 Work 選取。"
                : "This Work keeps its workspace; the new one is available for future Works."}
            {w.approval.worktreePreview.grantRead
              ? locale === "zh"
                ? "核准同時允許此 Work 讀取新工作區。"
                : "Approval also grants this Work read access to the new workspace."
              : locale === "zh"
                ? "不授予新工作區讀取權限。"
                : "No read access to the new workspace is granted."}
          </p>
          <dl className="worktree-proposal">
            {w.approval.worktreePreview.environmentTemplate && (
              <>
                <dt>
                  {locale === "zh"
                    ? "新容器設定"
                    : "New container configuration"}
                </dt>
                <dd>
                  <p>
                    {locale === "zh"
                      ? "核准也會複製以下容器設定，將掛載改為新工作區並切換此 Work。新容器仍須在 Computer 明確啟動；不會改用主機命令。"
                      : "Approval also clones this container configuration with the new workspace mount and switches this Work. Start the new environment explicitly in Computer; no host command fallback."}
                  </p>
                  <pre>
                    {JSON.stringify(
                      w.approval.worktreePreview.environmentTemplate,
                      null,
                      2,
                    )}
                  </pre>
                </dd>
              </>
            )}
            <dt>{locale === "zh" ? "目的地" : "Destination"}</dt>
            <dd>
              <code>{w.approval.worktreePreview.destination}</code>
            </dd>
            <dt>{locale === "zh" ? "本地分支" : "Local branch"}</dt>
            <dd>
              <code>{w.approval.worktreePreview.branch ?? "—"}</code>
            </dd>
            <dt>HEAD</dt>
            <dd>
              <code>{w.approval.worktreePreview.head ?? "—"}</code>
            </dd>
          </dl>
        </>
      ) : w.approval.tool === "workspace_write" ? (
        <WriteProposal
          key={w.approval.id + ":" + w.approval.revision}
          approval={w.approval}
          locale={locale}
          request={request}
        />
      ) : ["workspace_command", "computer_command"].includes(
          w.approval.tool,
        ) ? (
        <dl className="worktree-proposal">
          {w.approval.tool === "computer_command" && (
            <>
              <dt>{locale === "zh" ? "隔離環境" : "Isolated environment"}</dt>
              <dd>{w.environmentId} · /work</dd>
            </>
          )}
          <dt>{locale === "zh" ? "執行程式" : "Executable"}</dt>
          <dd>
            <code>
              {String(w.approval.targetPreview ?? w.approval.args.executable)}
            </code>
          </dd>
          <dt>{locale === "zh" ? "參數" : "Arguments"}</dt>
          <dd>
            <pre>{JSON.stringify(w.approval.args.args, null, 2)}</pre>
          </dd>
          <dt>{locale === "zh" ? "時間上限" : "Time limit"}</dt>
          <dd>{String(w.approval.args.timeoutMs)} ms</dd>
          <dt>{locale === "zh" ? "輸出上限" : "Output limit"}</dt>
          <dd>{String(w.approval.args.maxOutputBytes)} bytes</dd>
          <dt>{locale === "zh" ? "執行範圍" : "Execution scope"}</dt>
          <dd>
            {locale === "zh"
              ? "本機 OS 權限；無 sandbox"
              : "Local OS permissions; no sandbox"}
          </dd>
        </dl>
      ) : (
        <code>
          {w.approval.tool}({JSON.stringify(w.approval.args)})
        </code>
      )}
      <div className="actions">
        <button className="primary" onClick={() => decide(w, "approve")}>
          {[
            "mcp_call",
            "mcp_data",
            "workspace_write",
            "workspace_command",
            "workspace_worktree",
            "memory_write",
          ].includes(w.approval.tool)
            ? locale === "zh"
              ? "核准這次操作"
              : "Approve this operation"
            : t.approve}
        </button>
        <button onClick={() => decide(w, "reject")}>{t.reject}</button>
      </div>
    </section>
  );
}
