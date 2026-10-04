import { useEffect, useRef, useState, type FormEvent } from "react";
import type { useAgent } from "@copilotkit/react-core/v2";
import { ArrowUp, ChevronDown, Square } from "lucide-react";
import type { Work } from "../../../packages/contracts/src/index.js";
import type { Workspace } from "../../../packages/contracts/src/workspaces.js";
import type { Attachment } from "../../../packages/contracts/src/attachments.js";
import {
  modelBudgetSchema,
  type ModelBudget,
} from "../../../packages/contracts/src/model-budget.js";
import { AttachmentPicker, attachmentRefs } from "./attachments.js";
import { WorkBudget } from "./work-budget.js";
import { EnvironmentSelection } from "./environment-selection.js";
import { BrowserScope } from "./browser-scope.js";
import { labels, type Locale } from "./i18n.js";
import type { SelectedModel } from "./selected-model.js";

type Agent = ReturnType<typeof useAgent>["agent"];

/**
 * Message input. Everyday controls (model, attachments) stay visible; per-Work grants
 * and runtime limits live under one "advanced options" disclosure and reset after send.
 */
export function Composer({
  locale,
  request,
  agent,
  ready,
  selectedModel,
  onChangeModel,
  fixture,
  onFixture,
  workspace,
  onClearWorkspace,
  running,
  onStop,
  onError,
  draft,
}: {
  locale: Locale;
  request: (path: string, body?: unknown) => Promise<unknown>;
  agent: Agent;
  ready: boolean;
  selectedModel: SelectedModel | null;
  onChangeModel: () => void;
  fixture: boolean;
  onFixture: (enabled: boolean) => void;
  workspace?: Workspace;
  onClearWorkspace: () => void;
  running?: Work;
  onStop: (work: Work) => void;
  onError: (message: string) => void;
  /** A suggestion to place in the input; a new object replaces the text again. */
  draft?: { text: string };
}) {
  const t = labels[locale];
  const options = useRef<HTMLDetailsElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState(""),
    [busy, setBusy] = useState(false),
    [transport, setTransport] = useState<"stdio" | "http">("stdio"),
    [modelBudget, setModelBudget] = useState<ModelBudget | null>(() =>
      modelBudgetSchema.parse({}),
    ),
    [memoryScope, setMemoryScope] = useState<"off" | "user" | "project">("off"),
    [memoryPrivate, setMemoryPrivate] = useState(false),
    [workspaceRead, setWorkspaceRead] = useState(false),
    [environmentId, setEnvironmentId] = useState(""),
    [browserOrigins, setBrowserOrigins] = useState(""),
    [browserProfileId, setBrowserProfileId] = useState(""),
    [attachments, setAttachments] = useState<Attachment[]>([]),
    [attachmentBusy, setAttachmentBusy] = useState(false);
  // Grants are per Work: a new model or workspace never inherits earlier consent.
  useEffect(() => {
    setMemoryScope("off");
    setMemoryPrivate(false);
    setWorkspaceRead(false);
  }, [selectedModel?.connectionId, workspace?.id]);
  useEffect(() => {
    if (!draft) return;
    setText(draft.text);
    input.current?.focus();
  }, [draft]);
  const canSend =
    (fixture || !!selectedModel) &&
    !!text.trim() &&
    !busy &&
    !attachmentBusy &&
    modelBudget !== null &&
    ready;
  async function send(event: FormEvent) {
    event.preventDefault();
    if (!canSend) return;
    onError("");
    setBusy(true);
    if (options.current) options.current.open = false;
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
              ...(workspace
                ? {
                    workspaceId: workspace.id,
                    workspaceRevision: workspace.revision,
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
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="composer-tools">
        <button
          type="button"
          className="model-chip"
          onClick={onChangeModel}
          title={t.changeModel}
        >
          {t.model}:{" "}
          {selectedModel?.name ?? (fixture ? t.fixtureName : t.noModel)}
          <ChevronDown size={14} aria-hidden />
        </button>
        <details>
          <summary>
            {t.attachments}
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
        {workspace && (
          <span className="workspace-chip">
            {t.workspace}
            {workspace.name}
          </span>
        )}
        <details
          className="connection-options"
          ref={options}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.currentTarget.open = false;
              event.currentTarget.querySelector("summary")?.focus();
            }
          }}
        >
          <summary>{t.options}</summary>
          <section id="setup" className="setup">
            {selectedModel && (
              <>
                <label>
                  {t.memory}
                  <select
                    value={memoryScope}
                    onChange={(e) => {
                      setMemoryScope(e.target.value as typeof memoryScope);
                      setMemoryPrivate(false);
                    }}
                  >
                    <option value="off">{t.memoryOff}</option>
                    <option value="user">{t.memoryUser}</option>
                    {workspace && (
                      <option value="project">{t.memoryProject}</option>
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
                    {t.memoryPrivate}
                  </label>
                )}
              </>
            )}
            {workspace && (
              <>
                <label>
                  <input
                    type="checkbox"
                    disabled={!selectedModel}
                    checked={workspaceRead}
                    onChange={(e) => setWorkspaceRead(e.target.checked)}
                  />
                  {t.workspaceRead}
                </label>
                <button type="button" onClick={onClearWorkspace}>
                  {t.clearWorkspace}
                </button>
              </>
            )}
            <label>
              <input
                type="checkbox"
                checked={fixture}
                onChange={(e) => onFixture(e.target.checked)}
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
            <WorkBudget locale={locale} onChange={setModelBudget} />
            {selectedModel && (
              <details className="computer-scope">
                <summary>{t.environment}</summary>
                <EnvironmentSelection
                  workspaceId={workspace?.id}
                  workspaceRevision={workspace?.revision}
                  value={environmentId}
                  onChange={setEnvironmentId}
                  locale={locale}
                  request={request}
                />
                <BrowserScope
                  locale={locale}
                  origins={browserOrigins}
                  onOrigins={setBrowserOrigins}
                  selected={browserProfileId}
                  onSelect={setBrowserProfileId}
                  request={request}
                />
              </details>
            )}
          </section>
        </details>
      </div>
      <form id="compose" onSubmit={send}>
        <textarea
          ref={input}
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
        {running && (
          <button
            type="button"
            className="composer-stop"
            aria-label={t.stopCurrent}
            onClick={() => onStop(running)}
          >
            <Square size={14} aria-hidden />
          </button>
        )}
        <button className="primary" aria-label={t.send} disabled={!canSend}>
          <ArrowUp size={18} aria-hidden />
        </button>
      </form>
    </>
  );
}
