import { useEffect, useState, type FormEvent } from "react";
import { createRoot } from "react-dom/client";
import { CopilotKitProvider, useAgent } from "@copilotkit/react-core/v2";
import type { Work } from "../../../packages/contracts/src/index.js";
import { API_PREFIX } from "../../../packages/contracts/src/index.js";
import { useRockyProjection, workCommands } from "./rocky-adapter.js";
import { ModelSettings } from "./model-settings.js";
import { McpSettings } from "./mcp-settings.js";
import { WorkOperations } from "./work-operations.js";
import { WorkGrants } from "./work-grants.js";
import { WorkSteering } from "./work-steering.js";
import { WorkRetry } from "./work-retry.js";
import { Chrome, Transcript } from "./chrome.js";
import ReactMarkdown from "react-markdown";
import "./style.css";
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
      "我是 Rocky，一起用可核對的步驟把工作做完。你可以選擇自己的模型，或體驗合成流程；目前工具僅操作合成範例。",
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
      "I’m Rocky. Let’s work through clear steps and verifiable results. Select your own model or try the synthetic workflow; tools currently operate only on synthetic samples.",
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
  const [maxCalls, setMaxCalls] = useState("48");
  const validBudget =
    /^\d+$/.test(maxCalls) &&
    Number(maxCalls) >= 1 &&
    Number(maxCalls) <= 10000;
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
      !validBudget ||
      !isReady ||
      !connected
    )
      return;
    setError("");
    setBusy(true);
    try {
      agent.addMessage({
        id: crypto.randomUUID(),
        role: "user",
        content: text,
      });
      setText("");
      await agent.runAgent({
        runId: crypto.randomUUID(),
        forwardedProps: selectedModel
          ? {
              mode: "configured",
              transport,
              modelBudget: { maxCalls: Number(maxCalls) },
              modelSelection: {
                connectionId: selectedModel.connectionId,
                revision: selectedModel.revision,
              },
            }
          : {
              mode: "fixture",
              transport,
              modelBudget: { maxCalls: Number(maxCalls) },
            },
      });
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
      locale={locale}
      connected={connected}
      count={works.length}
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
          <ModelSettings
            locale={locale}
            request={request}
            onSelect={(model) => {
              setSelectedModel(model);
              setEnabled(false);
            }}
          />
          <McpSettings locale={locale} request={request} />
        </>
      }
    >
      <section className="chat-workspace">
        <div className={works.length ? "live-chat" : "new-conversation"}>
          <section className="conversation">
            <div
              className={works.length ? "chat-persona" : "empty-chat-persona"}
            >
              <img
                className="rocky-avatar"
                src="/rocky/avatar.svg"
                width="68"
                height="68"
                alt="Rocky"
              />
              <h1>{works.length ? "Rocky" : t.title}</h1>
              <p>
                {works.length
                  ? locale === "zh"
                    ? "一位持續助手 · 真實工作狀態"
                    : "One continuous assistant · confirmed work state"
                  : t.intro}
              </p>
            </div>
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
              {!works.length && <p className="empty">{t.empty}</p>}
              {works.map((w) => (
                <article className="work" key={w.id}>
                  <div className="work-heading">
                    <strong>{w.text}</strong>
                    <span className={"status " + w.status}>
                      {t.status[w.status]}
                    </span>
                  </div>
                  {w.retryOf && (
                    <small>
                      {locale === "zh"
                        ? "重試工作 · 新的執行"
                        : "Retry work · new execution"}
                    </small>
                  )}
                  {w.approval?.status === "pending" && (
                    <section className="approval">
                      <h2>{t.approval}</h2>
                      <p>{t.impact}</p>
                      <code>
                        {w.approval.tool}({JSON.stringify(w.approval.args)})
                      </code>
                      <div className="actions">
                        <button
                          className="primary"
                          onClick={() => void decide(w, "approve")}
                        >
                          {t.approve}
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
                  {w.error && <p role="alert">{w.error}</p>}
                  <details>
                    <summary>{t.detail}</summary>
                    <WorkGrants work={w} locale={locale} request={request} />
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
                  ? `使用 ${selectedModel.name}：訊息會送至此模型，可能產生費用。工具只操作合成範例。`
                  : `Using ${selectedModel.name}: messages go to this model and may incur charges. Tools operate only on synthetic samples.`}{" "}
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
            {error && (
              <p role="alert" className="error">
                {error}
              </p>
            )}
            <div className="composer-tools">
              <details className="connection-options">
                <summary>
                  {locale === "zh" ? "模型與工具" : "Model & tools"}
                </summary>{" "}
                <section id="setup" className="setup">
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
              <details className="work-budget">
                <summary>
                  {locale === "zh" ? "工作預算" : "Work budget"} ·{" "}
                  {maxCalls || "—"}
                </summary>
                <label htmlFor="max-model-calls">
                  {locale === "zh" ? "模型呼叫上限" : "Maximum model calls"}
                </label>{" "}
                <input
                  id="max-model-calls"
                  form="compose"
                  type="number"
                  min="1"
                  max="10000"
                  step="1"
                  required
                  value={maxCalls}
                  onChange={(event) => setMaxCalls(event.target.value)}
                  aria-describedby="budget-help"
                />
                <p id="budget-help">
                  {locale === "zh"
                    ? "每個新工作與其子代理共用此上限。送出後固定；這不是金額或 token 上限。"
                    : "Each new work shares this limit with its subagents. Fixed after sending; this is not a money or token limit."}
                </p>
              </details>
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
