import { Diagnostics } from "./diagnostics.js";
import { RoutineSettings } from "./routines.js";
import { TrackingSettings } from "./tracked-work.js";
import { lazy, useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { createRoot } from "react-dom/client";
import { CopilotKitProvider, useAgent } from "@copilotkit/react-core/v2";
import type { Work } from "../../../packages/contracts/src/index.js";
import { API_PREFIX } from "../../../packages/contracts/src/index.js";
import type { Artifact } from "../../../packages/contracts/src/artifacts.js";
import type { Workspace } from "../../../packages/contracts/src/workspaces.js";
import { useRockyProjection, workCommands } from "./rocky-adapter.js";
import { ModelSettings } from "./model-settings.js";
import { McpSettings } from "./mcp-settings.js";
import { MemorySettings } from "./memory-settings.js";
import { Workspaces } from "./workspaces.js";
import { RockyPresence } from "./rocky-presence.js";
import { Chrome, Transcript } from "./chrome.js";
import { WorkCard } from "./work-card.js";
import { Composer } from "./composer.js";
import { ModelOnboarding } from "./onboarding.js";
import { useModelSelection } from "./selected-model.js";
import { labels, type Locale } from "./i18n.js";
import "./style.css";
import "./theme.css";
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
function App() {
  const { agent, isReady } = useAgent({ agentId: "rocky" });
  const [locale, setLocale] = useState<Locale>("zh"),
    [theme, setTheme] = useState(() =>
      window.matchMedia?.("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light",
    ),
    [enabled, setEnabled] = useState(false);
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
  const {
    models,
    selected: selectedModel,
    setSelected: setSelectedModel,
    refresh: refreshModels,
  } = useModelSelection(request);
  const [choosingModel, setChoosingModel] = useState(false);
  const [draft, setDraft] = useState<{ text: string }>();
  const [error, setError] = useState("");
  const [resultRequest, setResultRequest] = useState<{ artifact: Artifact }>();
  const [focusedWork, setFocusedWork] = useState<{ id: string }>();
  const [selectedWorkspace, setSelectedWorkspace] = useState<Workspace>();
  const t = labels[locale];
  const focusedRecord = presenceWorks.find(
    (work) => work.id === focusedWork?.id && work.runMode === "normal",
  );
  const displayWorks =
    focusedRecord && !works.some((work) => work.id === focusedRecord.id)
      ? [...works, focusedRecord]
      : works;
  const running = works.findLast((w) =>
    ["queued", "running"].includes(w.status),
  );
  const showOnboarding =
    models !== null && (choosingModel || (!selectedModel && !enabled));
  // A fresh install (confirmed snapshot, no Works, no model connections) shows only the setup card.
  // The composer stays mounted while hidden so late-arriving data never resets its state.
  const firstRun =
    showOnboarding &&
    !choosingModel &&
    !displayWorks.length &&
    models?.length === 0 &&
    lastConfirmedAt !== undefined;
  useEffect(() => {
    if (!focusedWork) return;
    const element = document.getElementById("work-" + focusedWork.id);
    element?.focus({ preventScroll: true });
    element?.scrollIntoView({ block: "start" });
  }, [focusedWork]);
  useEffect(() => {
    document.documentElement.lang = locale === "zh" ? "zh-Hant" : "en";
    document.documentElement.dataset.theme = theme;
  }, [locale, theme]);
  function decide(w: Work, decision: "approve" | "reject") {
    void commands.decide(w, decision).catch((e) => setError(String(e)));
  }
  function stopWork(w: Work) {
    void commands.stop(w).catch((e) => setError(String(e)));
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
          onSelect={setSelectedWorkspace}
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
            {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
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
              setEnabled(false);
            }}
            onSaved={() => void refreshModels()}
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
              {displayWorks.map((w) => (
                <WorkCard
                  key={w.id}
                  w={w}
                  locale={locale}
                  request={request}
                  events={events}
                  stream={streams[w.id]?.text}
                  artifacts={artifacts.filter((a) => a.workId === w.id)}
                  connected={connected}
                  decide={decide}
                  stop={stopWork}
                  onOpenArtifact={(artifact) => setResultRequest({ artifact })}
                />
              ))}
              {showOnboarding && models ? (
                <ModelOnboarding
                  locale={locale}
                  request={request}
                  models={models}
                  onRefresh={refreshModels}
                  onSelect={(model) => {
                    setSelectedModel(model);
                    setEnabled(false);
                    setChoosingModel(false);
                  }}
                  onFixture={() => {
                    setSelectedModel(null);
                    setEnabled(true);
                    setChoosingModel(false);
                  }}
                  current={selectedModel}
                  onCancel={
                    choosingModel ? () => setChoosingModel(false) : undefined
                  }
                />
              ) : (
                !displayWorks.length && (
                  <div className="welcome">
                    <h2>{t.welcome}</h2>
                    <p className="empty">{t.welcomeHint}</p>
                    <div className="suggestions">
                      {t.suggestions.map((suggestion) => (
                        <button
                          type="button"
                          key={suggestion}
                          onClick={() => setDraft({ text: suggestion })}
                        >
                          {suggestion}
                        </button>
                      ))}
                    </div>
                  </div>
                )
              )}
            </Transcript>
          </section>
          <div
            className={
              firstRun ? "composer-notices" : "composer-wrap chat-composer"
            }
          >
            {!firstRun && (selectedModel || enabled) && (
              <p role="status" className="composer-status">
                {selectedModel
                  ? t.usingModel(selectedModel.name)
                  : t.usingFixture}{" "}
                <button
                  type="button"
                  className="link"
                  onClick={() => {
                    setSelectedModel(null);
                    setEnabled(false);
                  }}
                >
                  {t.clearModel}
                </button>
              </p>
            )}
            {(!connected || connectionError) && (
              <p className="connection-error" role="status">
                {connectionError || t.offline}{" "}
                <button onClick={reconnect}>{t.reconnect}</button>
              </p>
            )}
            {artifactError && (
              <p role="alert">
                {t.resultsFailed}{" "}
                <button disabled={artifactLoading} onClick={reloadArtifacts}>
                  {t.retryResults}
                </button>
              </p>
            )}
            {error && (
              <p role="alert" className="error">
                {error}
              </p>
            )}
            <div className="composer-body" hidden={firstRun}>
              <Composer
                locale={locale}
                request={request}
                agent={agent}
                ready={isReady && connected}
                selectedModel={selectedModel}
                onChangeModel={() => {
                  void refreshModels();
                  setChoosingModel((value) => !value);
                }}
                fixture={enabled}
                onFixture={(value) => {
                  setEnabled(value);
                  if (value) setSelectedModel(null);
                }}
                workspace={selectedWorkspace}
                onClearWorkspace={() => setSelectedWorkspace(undefined)}
                running={running}
                onStop={stopWork}
                onError={setError}
                draft={draft}
              />
            </div>
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
