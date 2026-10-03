import { useEffect, useState, type FormEvent } from "react";
import { createRoot } from "react-dom/client";
import { CopilotKitProvider, useAgent } from "@copilotkit/react-core/v2";
import type {
  Work,
  PublicEvent,
} from "../../../packages/contracts/src/index.js";
import "./style.css";
let session = "";
async function request(path: string, body?: unknown) {
  const response = await fetch("/api/v1" + path, {
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
      "先用合成資料驗證工作流程。真實模型連線尚未開放；這裡不會呼叫付費端點。",
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
    foot: "Node · Deep Agents · MCP｜P0 合成驗證",
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
      "Verify the workflow with synthetic data. Live model configuration is not available yet; no paid endpoints are called.",
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
    foot: "Node · Deep Agents · MCP | P0 fixture",
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
    void request("/works")
      .then((d) => {
        if (!disposed) setWorks(d.works);
      })
      .catch((e) => setError(String(e)));
    const stream = new EventSource("/api/v1/events");
    stream.onopen = () => setConnected(true);
    stream.onerror = () => setConnected(false);
    stream.onmessage = (e) => {
      const event = JSON.parse(e.data) as PublicEvent;
      setEvents((old) =>
        old.some((x) => x.id === event.id) ? old : [...old.slice(-499), event],
      );
      if (event.name === "rocky.work.updated") {
        const work = event.data.work as Work;
        setWorks((old) => {
          const found = old.find((x) => x.id === work.id);
          if (found && found.revision >= work.revision) return old;
          return found
            ? old.map((x) => (x.id === work.id ? work : x))
            : [...old, work];
        });
      }
    };
    return () => {
      disposed = true;
      stream.close();
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
          <span className="neutral-mark" aria-hidden>
            R
          </span>
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
          P0 · Development
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
                          e.workId === w.id && e.name !== "rocky.work.updated",
                      )
                      .map((e) => (
                        <li key={e.id}>
                          <span>{e.name.replace("rocky.", "")}</span>{" "}
                          <small>{String(e.data.name ?? "")}</small>
                          <details>
                            <summary>Evidence</summary>
                            <pre>{JSON.stringify(e.data, null, 2)}</pre>
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
