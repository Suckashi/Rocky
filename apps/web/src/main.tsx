import { WorkBudget } from "./work-budget.js";
import { EnvironmentSelection } from "./environment-selection.js";
import { BrowserScope } from "./browser-scope.js";
import {
  AttachmentPicker,
  AttachmentLinks,
  attachmentRefs,
} from "./attachments.js";
import type { Attachment } from "../../../packages/contracts/src/attachments.js";
import { RoutineSettings } from "./routines.js";
import { TrackingSettings } from "./tracked-work.js";
import { WorkUsage } from "./work-usage.js";
import { Diagnostics } from "./diagnostics.js";
import {
  modelBudgetSchema,
  type ModelBudget,
} from "../../../packages/contracts/src/model-budget.js";
import { ToolActivity } from "./tool-activity.js";
import { lazy, useEffect, useRef, useState, type FormEvent } from "react";
import { createRoot } from "react-dom/client";
import { CopilotKitProvider, useAgent } from "@copilotkit/react-core/v2";
import type { Work } from "../../../packages/contracts/src/index.js";
import { API_PREFIX } from "../../../packages/contracts/src/index.js";
import { useRockyProjection, workCommands } from "./rocky-adapter.js";
import { ModelSettings } from "./model-settings.js";
import { McpSettings } from "./mcp-settings.js";
import { MemorySettings } from "./memory-settings.js";

import { SkillRevocation } from "./skill-revocation.js";
import { WriteProposal } from "./write-proposal.js";
import { MemoryProposal } from "./memory-proposal.js";
import { WorkArtifacts } from "./work-artifacts.js";
import type { Artifact } from "../../../packages/contracts/src/artifacts.js";

import { Workspaces } from "./workspaces.js";
import type { Workspace } from "../../../packages/contracts/src/workspaces.js";
import { WorkOperations } from "./work-operations.js";
import { WorkLearning } from "./work-learning.js";
import { WorkGrants } from "./work-grants.js";
import { WorkSteering } from "./work-steering.js";
import { WorkRetry } from "./work-retry.js";
import { RockyPresence } from "./rocky-presence.js";
import { Chrome, Transcript } from "./chrome.js";
import ReactMarkdown from "react-markdown";
import "./style.css";
const ComputerPanel = lazy(() =>
  import("./computer-panel.js").then((module) => ({
    default: module.ComputerPanel,
  })),
);
const LearningSettings = lazy(() =>
  import("./learning-settings.js").then((module) => ({
    default: module.LearningSettings,
  })),
);
const SkillSettings = lazy(() =>
  import("./skill-settings.js").then((module) => ({
    default: module.SkillSettings,
  })),
);
const Artifacts = lazy(() =>
  import("./artifacts.js").then((module) => ({ default: module.Artifacts })),
);
let session = "";
async function request(path: string, body?: unknown) {
  const response = await fetch(API_PREFIX + path, {
    method: body ? "POST" : "GET",
    headers: body
      ? { "content-type": "application/json", "x-rocky-session": session }
      : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json();
  if (!response.ok) throw Error(data.message ?? "Request failed");
  return data;
}
const commands = workCommands(request);
const labels = {
  zh: {
    chat: "對話",
    work: "工作",
    setup: "本地連線",
    title: "一起把問題做完。",
    intro:
      "我是 Rocky，一起用可核對的步驟把工作做完。選擇自己的模型與 MCP 工具；外部操作會先請你核准。也可以啟用合成測試流程。",
    fixture: "啟用合成測試",
    placeholder: "描述想驗證的流程…",
    send: "開始驗證",
    detail: "工作詳情",
    approve: "核准這次寫入",
    reject: "拒絕",
    stop: "停止",
    empty: "尚無工作。你的第一項驗證會出現在這裡。",
    offline: "連線中斷；顯示最後確認狀態",
    online: "本機已連線",
    foot: "Node · Deep Agents · MCP｜合成驗證",
    approval: "這個操作需要你的核准",
    impact: "只寫入合成 MCP 範例，不修改你的檔案。",
    status: {
      queued: "排隊中",
      running: "執行中",
      waiting_approval: "待核准",
      completed: "已完成",
      failed: "失敗",
      cancelled: "已取消",
      blocked: "需對帳",
      interrupted: "已中斷",
    },
  },
  en: {
    chat: "Chat",
    work: "Work",
    setup: "Local connection",
    title: "Let’s work through it.",
    intro:
      "I’m Rocky. Let’s work through clear steps and verifiable results. Select your model and MCP tools; external calls ask for your approval. A synthetic test workflow is also available.",
    fixture: "Enable synthetic fixture",
    placeholder: "Describe a workflow to verify…",
    send: "Run verification",
    detail: "Work details",
    approve: "Approve this write",
    reject: "Reject",
    stop: "Stop",
    empty: "No work yet. Your first verification will appear here.",
    offline: "Disconnected; showing last confirmed state",
    online: "Connected locally",
    foot: "Node · Deep Agents · MCP | Synthetic fixture",
    approval: "This action needs your approval",
    impact: "Writes only to the synthetic MCP sample, never your files.",
    status: {
      queued: "Queued",
      running: "Running",
      waiting_approval: "Needs approval",
      completed: "Completed",
      failed: "Failed",
      cancelled: "Cancelled",
      blocked: "Needs reconciliation",
      interrupted: "Interrupted",
    },
  },
};
function App() {
  const { agent, isReady } = useAgent({ agentId: "rocky" });
  const [locale, setLocale] = useState<"zh" | "en">("zh"),
    [theme, setTheme] = useState("light"),
    [enabled, setEnabled] = useState(false),
    [transport, setTransport] = useState<"stdio" | "http">("stdio");
  const {
    works,
    presenceWorks,
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
  } = useRockyProjection(request);
  const [text, setText] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [resultRequest, setResultRequest] = useState<{ artifact: Artifact }>();
  const [focusedWork, setFocusedWork] = useState<{ id: string }>();
  const focusedRecord = presenceWorks.find(
    (work) => work.id === focusedWork?.id && work.runMode === "normal",
  );
  const displayWorks =
    focusedRecord && !works.some((work) => work.id === focusedRecord.id)
      ? [...works, focusedRecord]
      : works;
  useEffect(() => {
    if (!focusedWork) return;
    const element = document.getElementById("work-" + focusedWork.id);
    element?.focus({ preventScroll: true });
    element?.scrollIntoView({ block: "start" });
  }, [focusedWork]);
  const [modelBudget, setModelBudget] = useState<ModelBudget | null>(() =>
    modelBudgetSchema.parse({}),
  );
  const modelTools = useRef<HTMLDetailsElement>(null);
  const [memoryScope, setMemoryScope] = useState<"off" | "user" | "project">(
    "off",
  );
  const [memoryPrivate, setMemoryPrivate] = useState(false);
  const [selectedWorkspace, setSelectedWorkspace] = useState<Workspace>(),
    [workspaceRead, setWorkspaceRead] = useState(false);
  const validBudget = modelBudget !== null;
  const [environmentId, setEnvironmentId] = useState("");
  const [browserOrigins, setBrowserOrigins] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [attachmentBusy, setAttachmentBusy] = useState(false);
  const [browserProfileId, setBrowserProfileId] = useState("");
  const t = labels[locale];
  const [selectedModel, setSelectedModel] = useState<{
    connectionId: string;
    revision: number;
    name: string;
  } | null>(null);
  useEffect(() => {
    document.documentElement.lang = locale === "zh" ? "zh-Hant" : "en";
    document.documentElement.dataset.theme = theme;
  }, [locale, theme]);
  async function send(e: FormEvent) {
    e.preventDefault();
    if (
      !text.trim() ||
      (!enabled && !selectedModel) ||
      busy ||
      attachmentBusy ||
      !validBudget ||
      !isReady ||
      !connected
    )
      return;
    setError("");
    setBusy(true);
    if (modelTools.current) modelTools.current.open = false;
    try {
      agent.addMessage({
        id: crypto.randomUUID(),
        role: "user",
        content: text,
      });
      setText("");
      setWorkspaceRead(false);
      setMemoryScope("off");
      setMemoryPrivate(false);
      await agent.runAgent({
        runId: crypto.randomUUID(),
        forwardedProps: selectedModel
          ? {
              mode: "configured",
              attachments: attachmentRefs(attachments),
              ...(environmentId ? { environmentId } : {}),
              ...(browserProfileId
                ? { browserProfileId }
                : browserOrigins.trim()
                  ? {
                      browserOrigins: browserOrigins
                        .split(/\r?\n/)
                        .map((value) => value.trim())
                        .filter(Boolean),
                    }
                  : {}),
              ...(memoryScope !== "off"
                ? {
                    memoryRead: [
                      { scope: memoryScope, includePrivate: memoryPrivate },
                    ],
                  }
                : {}),
              ...(selectedWorkspace
                ? {
                    workspaceId: selectedWorkspace.id,
                    workspaceRevision: selectedWorkspace.revision,
                    workspaceRead,
                  }
                : {}),
              transport,
              modelBudget,
              modelSelection: {
                connectionId: selectedModel.connectionId,
                revision: selectedModel.revision,
              },
            }
          : {
              mode: "fixture",
              attachments: attachmentRefs(attachments),
              transport,
              modelBudget,
            },
      });
      setAttachments([]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  async function decide(w: Work, decision: "approve" | "reject") {
    try {
      await commands.decide(w, decision);
    } catch (e) {
      setError(String(e));
    }
  }
  async function stopWork(w: Work) {
    try {
      await commands.stop(w);
    } catch (e) {
      setError(String(e));
    }
  }
  return (
    <Chrome
      computer={
        <ComputerPanel
          locale={locale}
          works={presenceWorks}
          events={events}
          request={request}
        />
      }
      learning={<LearningSettings locale={locale} request={request} />}
      skills={<SkillSettings locale={locale} request={request} />}
      locale={locale}
      connected={connected}
      count={works.length}
      resultRequest={resultRequest}
      artifacts={
        <Artifacts
          items={artifacts}
          loadError={artifactError}
          loading={artifactLoading}
          onRetry={reloadArtifacts}
          initialArtifact={resultRequest?.artifact}
          locale={locale}
          request={request}
          revision={
            events.findLast(
              (e) =>
                e.payload.kind === "domain" &&
                ["rocky.artifact.published", "rocky.document.updated"].includes(
                  e.payload.name,
                ),
            )?.sequence ?? "0"
          }
        />
      }
      workspaces={
        <Workspaces
          locale={locale}
          request={request}
          onSelect={(workspace) => {
            setSelectedWorkspace(workspace);
            setMemoryScope("off");
            setMemoryPrivate(false);
            setWorkspaceRead(false);
          }}
        />
      }
      actions={
        <>
          <button onClick={() => setLocale(locale === "zh" ? "en" : "zh")}>
            {locale === "zh" ? "English" : "繁體中文"}
          </button>
          <button
            aria-label="Toggle theme"
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          >
            {theme === "dark" ? "☀" : "☾"}
          </button>
        </>
      }
      settings={
        <>
          <p>
            {locale === "zh"
              ? "資料保存在本機；網路連線只使用你明確配置的模型、MCP 與核准的操作。保存設定不會啟動測試或連線。"
              : "Data stays local. Network connections use your explicitly configured models, MCP servers and approved operations. Saving settings does not start a probe or connection."}
          </p>
          <ModelSettings
            locale={locale}
            request={request}
            onSelect={(model) => {
              setSelectedModel(model);
              setMemoryScope("off");
              setMemoryPrivate(false);
              setEnabled(false);
            }}
          />
          <McpSettings locale={locale} request={request} />
          <Diagnostics locale={locale} request={request} />
          <RoutineSettings locale={locale} request={request} />
          <TrackingSettings
            locale={locale}
            works={presenceWorks}
            request={request}
          />
          <MemorySettings
            locale={locale}
            request={request}
            works={presenceWorks}
          />
        </>
      }
    >
      <section className="chat-workspace">
        <div className={works.length ? "live-chat" : "new-conversation"}>
          <section className="conversation">
            <RockyPresence
              works={presenceWorks}
              onOpenWork={(id) => setFocusedWork({ id })}
              completion={completion}
              lastConfirmedAt={lastConfirmedAt}
              events={events}
              connected={connected}
              configured={!!selectedModel || enabled}
              locale={locale}
            />
            <Transcript
              revision={
                `${works.at(-1)?.id ?? ""}:${works.at(-1)?.revision ?? 0}` +
                ":" +
                (events.at(-1)?.sequence ?? "0")
              }
            >
              {historyCursor && (
                <button
                  type="button"
                  className="history-load"
                  disabled={historyLoading}
                  onClick={(event) => {
                    const button = event.currentTarget;
                    void loadEarlier().then(() =>
                      requestAnimationFrame(() => {
                        if (button.isConnected)
                          button.focus({ preventScroll: true });
                        else
                          document
                            .getElementById("works")
                            ?.focus({ preventScroll: true });
                      }),
                    );
                  }}
                >
                  {historyLoading
                    ? locale === "zh"
                      ? "載入中…"
                      : "Loading…"
                    : locale === "zh"
                      ? "載入較早的訊息"
                      : "Load earlier messages"}
                </button>
              )}
              {historyError && (
                <p role="alert" className="history-error">
                  {historyError}
                </p>
              )}
              {!displayWorks.length && <p className="empty">{t.empty}</p>}
              {displayWorks.map((w) => (
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
                  {w.approval?.status === "pending" && (
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
                                  task:
                                    locale === "zh" ? "此工作" : "This Work",
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
                                    (
                                      w.approval.args.target as Record<
                                        string,
                                        unknown
                                      >
                                    )?.uri ??
                                    (
                                      w.approval.args.target as Record<
                                        string,
                                        unknown
                                      >
                                    )?.uriTemplate ??
                                    (
                                      w.approval.args.target as Record<
                                        string,
                                        unknown
                                      >
                                    )?.name ??
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
                              {locale === "zh"
                                ? "檢查待執行參數"
                                : "Review exact arguments"}
                            </summary>
                            <pre>
                              {JSON.stringify(
                                w.approval.args.arguments ??
                                  w.approval.args.target,
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
                            {w.approval.worktreePreview.isolation ===
                            "directory"
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
                                      w.approval.worktreePreview
                                        .environmentTemplate,
                                      null,
                                      2,
                                    )}
                                  </pre>
                                </dd>
                              </>
                            )}
                            <dt>
                              {locale === "zh" ? "目的地" : "Destination"}
                            </dt>
                            <dd>
                              <code>
                                {w.approval.worktreePreview.destination}
                              </code>
                            </dd>
                            <dt>
                              {locale === "zh" ? "本地分支" : "Local branch"}
                            </dt>
                            <dd>
                              <code>
                                {w.approval.worktreePreview.branch ?? "—"}
                              </code>
                            </dd>
                            <dt>HEAD</dt>
                            <dd>
                              <code>
                                {w.approval.worktreePreview.head ?? "—"}
                              </code>
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
                              <dt>
                                {locale === "zh"
                                  ? "隔離環境"
                                  : "Isolated environment"}
                              </dt>
                              <dd>{w.environmentId} · /work</dd>
                            </>
                          )}
                          <dt>{locale === "zh" ? "執行程式" : "Executable"}</dt>
                          <dd>
                            <code>
                              {String(
                                w.approval.targetPreview ??
                                  w.approval.args.executable,
                              )}
                            </code>
                          </dd>
                          <dt>{locale === "zh" ? "參數" : "Arguments"}</dt>
                          <dd>
                            <pre>
                              {JSON.stringify(w.approval.args.args, null, 2)}
                            </pre>
                          </dd>
                          <dt>{locale === "zh" ? "時間上限" : "Time limit"}</dt>
                          <dd>{String(w.approval.args.timeoutMs)} ms</dd>
                          <dt>
                            {locale === "zh" ? "輸出上限" : "Output limit"}
                          </dt>
                          <dd>
                            {String(w.approval.args.maxOutputBytes)} bytes
                          </dd>
                          <dt>
                            {locale === "zh" ? "執行範圍" : "Execution scope"}
                          </dt>
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
                        <button
                          className="primary"
                          onClick={() => void decide(w, "approve")}
                        >
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
                        <button onClick={() => void decide(w, "reject")}>
                          {t.reject}
                        </button>
                      </div>
                    </section>
                  )}
                  {(w.answer ||
                    (w.status === "running" && streams[w.id]?.text)) && (
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
                        {w.answer || streams[w.id]?.text || ""}
                      </ReactMarkdown>
                    </div>
                  )}
                  <ToolActivity work={w} events={events} locale={locale} />
                  <WorkArtifacts
                    items={artifacts.filter((a) => a.workId === w.id)}
                    locale={locale}
                    onOpen={(artifact) => setResultRequest({ artifact })}
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
                  {["queued", "running", "waiting_approval"].includes(
                    w.status,
                  ) && (
                    <button
                      className="stop"
                      onClick={() =>
                        void commands.stop(w).catch((e) => setError(String(e)))
                      }
                    >
                      {t.stop}
                    </button>
                  )}
                </article>
              ))}
            </Transcript>
          </section>
          <div className="composer-wrap chat-composer">
            {selectedModel && (
              <p role="status">
                {locale === "zh"
                  ? `使用 ${selectedModel.name}：訊息會送至此模型，可能產生費用。配置的 MCP 操作需先核准。`
                  : `Using ${selectedModel.name}: messages go to this model and may incur charges. Configured MCP calls require approval.`}{" "}
                <button onClick={() => setSelectedModel(null)}>
                  {locale === "zh" ? "取消選取" : "Clear selection"}
                </button>
              </p>
            )}
            {(!connected || connectionError) && (
              <p className="connection-error" role="status">
                {connectionError || t.offline}{" "}
                <button onClick={reconnect}>
                  {locale === "zh" ? "重新連線" : "Reconnect"}
                </button>
              </p>
            )}
            {artifactError && (
              <p role="alert">
                {locale === "zh"
                  ? "成果清單載入失敗；對話仍可使用。"
                  : "Results failed to load; conversation is still available."}{" "}
                <button disabled={artifactLoading} onClick={reloadArtifacts}>
                  {locale === "zh" ? "重試成果清單" : "Retry results"}
                </button>
              </p>
            )}
            {error && (
              <p role="alert" className="error">
                {error}
              </p>
            )}
            <div className="composer-tools">
              <details
                className="connection-options"
                ref={modelTools}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    event.currentTarget.open = false;
                    event.currentTarget.querySelector("summary")?.focus();
                  }
                }}
              >
                <summary>
                  {locale === "zh" ? "模型與工具" : "Model & tools"}
                </summary>{" "}
                <section id="setup" className="setup">
                  {selectedModel && (
                    <>
                      <label>
                        {locale === "zh"
                          ? "本次工作可讀取的記憶"
                          : "Memory available to this Work"}
                        <select
                          value={memoryScope}
                          onChange={(e) => {
                            setMemoryScope(
                              e.target.value as typeof memoryScope,
                            );
                            setMemoryPrivate(false);
                          }}
                        >
                          <option value="off">
                            {locale === "zh" ? "不授權" : "No access"}
                          </option>
                          <option value="user">
                            {locale === "zh" ? "個人記憶" : "User memory"}
                          </option>
                          {selectedWorkspace && (
                            <option value="project">
                              {locale === "zh"
                                ? "所選專案記憶"
                                : "Selected project memory"}
                            </option>
                          )}
                        </select>
                      </label>
                      {memoryScope !== "off" && (
                        <label>
                          <input
                            type="checkbox"
                            checked={memoryPrivate}
                            onChange={(e) => setMemoryPrivate(e.target.checked)}
                          />
                          {locale === "zh"
                            ? "允許將私密記憶提供給本次模型"
                            : "Allow private memory to be sent to this model"}
                        </label>
                      )}
                    </>
                  )}
                  {selectedWorkspace && (
                    <>
                      <span>
                        {locale === "zh" ? "工作區：" : "Workspace: "}
                        {selectedWorkspace.name}
                      </span>
                      <label>
                        <input
                          type="checkbox"
                          disabled={!selectedModel}
                          checked={workspaceRead}
                          onChange={(e) => setWorkspaceRead(e.target.checked)}
                        />
                        {locale === "zh"
                          ? "允許此工作讀取工作區（含臨時子任務）"
                          : "Allow workspace reads for this Work and ephemeral children"}
                      </label>
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedWorkspace(undefined);
                          setWorkspaceRead(false);
                          setMemoryScope("off");
                          setMemoryPrivate(false);
                        }}
                      >
                        {locale === "zh" ? "取消工作區選取" : "Clear workspace"}
                      </button>
                    </>
                  )}
                  <label>
                    <input
                      type="checkbox"
                      checked={enabled}
                      onChange={(e) => {
                        setEnabled(e.target.checked);
                        if (e.target.checked) setSelectedModel(null);
                      }}
                    />
                    {t.fixture}
                  </label>
                  <select
                    aria-label="MCP transport"
                    value={transport}
                    onChange={(e) =>
                      setTransport(e.target.value as "stdio" | "http")
                    }
                  >
                    <option value="stdio">MCP · stdio</option>
                    <option value="http">MCP · Streamable HTTP</option>
                  </select>
                </section>
              </details>
              <WorkBudget locale={locale} onChange={setModelBudget} />
              <details>
                <summary>
                  {locale === "zh" ? "附件" : "Attachments"}
                  {attachments.length ? ` · ${attachments.length}` : ""}
                </summary>
                <AttachmentPicker
                  value={attachments}
                  onChange={setAttachments}
                  onBusyChange={setAttachmentBusy}
                  request={request}
                  locale={locale}
                  disabled={busy}
                />
              </details>
              {selectedModel && (
                <details className="computer-scope">
                  <summary>
                    {locale === "zh"
                      ? "執行環境與 Browser"
                      : "Environment & Browser"}
                  </summary>
                  {selectedModel && (
                    <EnvironmentSelection
                      workspaceId={selectedWorkspace?.id}
                      workspaceRevision={selectedWorkspace?.revision}
                      value={environmentId}
                      onChange={setEnvironmentId}
                      locale={locale}
                      request={request}
                    />
                  )}
                  {selectedModel && (
                    <BrowserScope
                      locale={locale}
                      origins={browserOrigins}
                      onOrigins={setBrowserOrigins}
                      selected={browserProfileId}
                      onSelect={setBrowserProfileId}
                      request={request}
                    />
                  )}
                </details>
              )}
            </div>
            <form id="compose" onSubmit={send}>
              <textarea
                aria-label={t.placeholder}
                placeholder={t.placeholder}
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (
                    e.key === "Enter" &&
                    !e.shiftKey &&
                    !e.nativeEvent.isComposing
                  ) {
                    e.preventDefault();
                    e.currentTarget.form?.requestSubmit();
                  }
                }}
                rows={2}
              />
              {works.findLast((w) =>
                ["queued", "running"].includes(w.status),
              ) && (
                <button
                  type="button"
                  className="composer-stop"
                  aria-label={
                    locale === "zh" ? "停止目前工作" : "Stop current work"
                  }
                  onClick={() => {
                    const work = works.findLast((w) =>
                      ["queued", "running"].includes(w.status),
                    );
                    if (work) void stopWork(work);
                  }}
                >
                  ■
                </button>
              )}
              <button
                className="primary"
                disabled={
                  (!enabled && !selectedModel) ||
                  !text.trim() ||
                  busy ||
                  attachmentBusy ||
                  !validBudget ||
                  !isReady ||
                  !connected
                }
              >
                {selectedModel
                  ? locale === "zh"
                    ? "傳送至模型"
                    : "Send to model"
                  : t.send}{" "}
                ↗
              </button>
            </form>
          </div>
        </div>
      </section>
    </Chrome>
  );
}
async function bootstrap() {
  try {
    session = (await request("/session")).token;
    createRoot(document.getElementById("root")!).render(
      <CopilotKitProvider
        runtimeUrl="/api/v1/copilotkit"
        headers={{ "x-rocky-session": session }}
        agentId="rocky"
        enableInspector={false}
        showDevConsole={false}
      >
        <App />
      </CopilotKitProvider>,
    );
  } catch {
    document.getElementById("root")!.textContent =
      "Rocky daemon unavailable. Start npm run dev and reload.";
  }
}
void bootstrap();
