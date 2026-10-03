import { useEffect, useState, type FormEvent } from "react";
import { createRoot } from "react-dom/client";
import { CopilotKitProvider, useAgent } from "@copilotkit/react-core/v2";
import type {
  Work,
  PublicEvent,
} from "../../../packages/contracts/src/index.js";
import {
  API_PREFIX,
  publicEventSchema,
  snapshotSchema,
} from "../../../packages/contracts/src/index.js";
import { projectWork, projectEvidence } from "./projection.js";
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
const labels = {
  zh: {
    chat: "對話",
    work: "工作",
    setup: "本地連線",
    title: "一起把問題做完。",
    intro:
      "我是 Rocky，一起用可核對的步驟把工作做完。目前可先體驗合成測試流程；真實模型連線尚未開放，不會呼叫付費端點。",
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
      "I’m Rocky. Let’s work through clear steps and verifiable results. Try the synthetic workflow for now; live model setup is not available and no paid endpoints are called.",
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
    [theme, setTheme] = useState("dark"),
    [enabled, setEnabled] = useState(false),
    [transport, setTransport] = useState<"stdio" | "http">("stdio");
  const [works, setWorks] = useState<Work[]>([]),
    [events, setEvents] = useState<PublicEvent[]>([]),
    [text, setText] = useState(""),
    [error, setError] = useState(""),
    [connected, setConnected] = useState(false),
    [busy, setBusy] = useState(false);
  const t = labels[locale];
  useEffect(() => {
    document.documentElement.lang = locale === "zh" ? "zh-Hant" : "en";
    document.documentElement.dataset.theme = theme;
  }, [locale, theme]);
  useEffect(() => {
    let disposed = false;
    let stream: EventSource | undefined;
    void request("/snapshot")
      .then((d) => {
        if (disposed) return;
        const snapshot = snapshotSchema.parse(d);
        setWorks(snapshot.works);
        setEvents(snapshot.events);
        stream = new EventSource(
          API_PREFIX + "/events?after=" + snapshot.cursor,
        );
        stream.onopen = () => setConnected(true);
        stream.onerror = () => setConnected(false);
        stream.onmessage = (e) => {
          try {
            const event = publicEventSchema.parse(JSON.parse(e.data));
            setEvents((old) => projectEvidence(old, event));
            setWorks((old) => projectWork(old, event));
          } catch {
            setConnected(false);
            setError("Invalid server event; reload to resynchronize.");
            stream?.close();
          }
        };
      })
      .catch((e) => {
        if (!disposed) setError(String(e));
      });
    return () => {
      disposed = true;
      stream?.close();
    };
  }, []);
  async function send(e: FormEvent) {
    e.preventDefault();
    if (!text.trim() || !enabled || busy) return;
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
        forwardedProps: { mode: "fixture", transport },
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  async function decide(w: Work, decision: "approve" | "reject") {
    try {
      await request("/approvals/" + w.approval!.id + "/decision", {
        requestId: crypto.randomUUID(),
        expectedRevision: w.approval!.revision,
        intentFingerprint: w.approval!.intentFingerprint,
        decision,
      });
    } catch (e) {
      setError(String(e));
    }
  }
  return (
    <div className="shell">
      <aside>
        <a className="brand" href="/" aria-label="Rocky home">
          <img src="/rocky/mark.svg" width="32" height="32" alt="" />
          Rocky
        </a>
        <nav>
          <a href="#chat" className="selected">
            {t.chat}
          </a>
          <a href="#works">
            {t.work}
            <span>{works.length}</span>
          </a>
          <a href="#setup">{t.setup}</a>
        </nav>
        <div className="sidebar-note">
          LOCAL + EXPLICIT NETWORK
          <br />
          Development · Fixture
        </div>
      </aside>
      <main id="chat">
        <header>
          <span className={connected ? "connection" : "connection warning"}>
            {connected ? t.online : t.offline}
          </span>
          <div>
            <button onClick={() => setLocale(locale === "zh" ? "en" : "zh")}>
              {locale === "zh" ? "English" : "繁體中文"}
            </button>
            <button
              aria-label="Toggle theme"
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            >
              {theme === "dark" ? "☀" : "☾"}
            </button>
          </div>
        </header>
        <section className="conversation">
          <div className="welcome">
            <img
              className="rocky-avatar"
              src="/rocky/avatar.svg"
              width="96"
              height="96"
              alt="Rocky"
            />
            <span className="eyebrow">ROCKY / ENGINEERING PARTNER</span>
            <h1>{t.title}</h1>
            <p>{t.intro}</p>
          </div>
          <section id="setup" className="setup">
            <label>
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
              />
              {t.fixture}
            </label>
            <select
              aria-label="MCP transport"
              value={transport}
              onChange={(e) => setTransport(e.target.value as "stdio" | "http")}
            >
              <option value="stdio">MCP · stdio</option>
              <option value="http">MCP · Streamable HTTP</option>
            </select>
          </section>
          <div id="works" className="works">
            {!works.length && <p className="empty">{t.empty}</p>}
            {works.map((w) => (
              <article className="work" key={w.id}>
                <div className="work-heading">
                  <strong>{w.text}</strong>
                  <span className={"status " + w.status}>
                    {t.status[w.status]}
                  </span>
                </div>
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
                {w.answer && <p className="answer">{w.answer}</p>}
                {w.error && <p role="alert">{w.error}</p>}
                <details>
                  <summary>{t.detail}</summary>
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
                      void request("/works/" + w.id + "/stop", {
                        requestId: crypto.randomUUID(),
                        runId: w.runId,
                        executionSessionId: w.executionSessionId,
                        expectedRevision: w.revision,
                      }).catch((e) => setError(String(e)))
                    }
                  >
                    {t.stop}
                  </button>
                )}
              </article>
            ))}
          </div>
        </section>
        <div className="composer-wrap">
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          <form onSubmit={send}>
            <textarea
              aria-label={t.placeholder}
              placeholder={t.placeholder}
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={2}
            />
            <button
              className="primary"
              disabled={
                !enabled || !text.trim() || busy || !isReady || !connected
              }
            >
              {t.send} ↗
            </button>
          </form>
          <footer>{t.foot}</footer>
        </div>
      </main>
    </div>
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
