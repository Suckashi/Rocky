// One conversation: history from the local runner, streaming reply, tool cards, approvals
// (in place of the input box), per-turn file changes, and actions with an unknown outcome.
import { useAgent, useCopilotKit } from '@copilotkit/react-core/v2';
import { ArrowUp, Cpu, FolderOpen, ListChecks, CircleStop } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import {
  api,
  ApiError,
  type Mode,
  type PendingApproval,
  type Receipt,
  type Settings,
} from '../api.ts';
import { useI18n } from '../i18n/index.tsx';
import {
  placeChangeCards,
  runsWithChanges,
  type Snapshot,
} from '../change-cards.ts';
import { runFailure } from '../run-errors.ts';
import { ApprovalPanel, type Answer } from './ApprovalPanel.tsx';
import { PlanPanel } from './PlanPanel.tsx';
import { filePreview, isPreviewable, useOpenPreview } from './PreviewPane.tsx';
import { ModeSelect } from './ModeSelect.tsx';
import { Roko, type RokoState } from './Roko.tsx';
import { ToolCard, type ToolState } from './ToolCard.tsx';
import { TurnChanges } from './TurnChanges.tsx';
import { JobCards } from './JobCards.tsx';
import { UnknownOutcome } from './UnknownOutcome.tsx';
import { CodeBlock } from './CodeBlock.tsx';

const AGENT_ID = 'rocky';

function textOf(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part: { type?: string; text?: string }) =>
        part.type === 'text' ? (part.text ?? '') : '',
      )
      .join('');
  }
  return '';
}

interface ToolCall {
  id: string;
  function: { name: string; arguments: string };
}

/** Inline code that names a previewable file opens it in the preview panel. */
function InlineCode({ children }: { children?: ReactNode }) {
  const { t } = useI18n();
  const open = useOpenPreview();
  const text = typeof children === 'string' ? children : '';
  if (
    !text ||
    text.includes('\n') ||
    !isPreviewable(text) ||
    /^[a-z]+:/i.test(text)
  )
    return <code>{children}</code>;
  return (
    <button
      type="button"
      className="code-link"
      title={t('preview.open')}
      onClick={() => open(filePreview(text))}
    >
      <code>{text}</code>
    </button>
  );
}

const markdownComponents: Components = {
  pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
  img: ({ alt }) => <span>{alt}</span>,
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noreferrer">
      {children}
    </a>
  ),
  code: ({ className, children }) =>
    className ? (
      <code className={className}>{children}</code>
    ) : (
      <InlineCode>{children}</InlineCode>
    ),
};

/** Touch screens have no Enter or Shift+Enter to explain. */
const coarsePointer =
  typeof window !== 'undefined' &&
  (window.matchMedia?.('(pointer: coarse)').matches ?? false);

/** Ways to begin a conversation; a click puts the words in the input box, never sends them. */
const STARTERS = [
  'chat.starter.explain',
  'chat.starter.improve',
  'chat.starter.readme',
] as const;

export function Chat({
  threadId,
  project,
  mode,
  model,
  onActivity,
  onSettings,
  onOpenSettings,
}: {
  threadId: string;
  project: string | null;
  /** The approval mode, one setting for every conversation; App owns it. */
  mode: Mode;
  /** The configured model's name, shown beside the input box. */
  model: string | null;
  onActivity: () => void;
  /** The settings changed here (the approval mode); App keeps the one copy. */
  onSettings: (settings: Settings) => void;
  onOpenSettings: () => void;
}) {
  const { t } = useI18n();
  const { agent, isReady } = useAgent({
    agentId: `chat-${threadId}`,
    runtimeAgentId: AGENT_ID,
    threadId,
  });
  const { copilotkit } = useCopilotKit();
  const [draft, setDraft] = useState('');
  const [running, setRunning] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [pending, setPending] = useState<PendingApproval[]>([]);
  const [planning, setPlanning] = useState(false);
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  // Set when the run request itself fails (refused, too large, offline): no RUN_ERROR comes.
  const failed = useRef<unknown>(undefined);
  // Whether the server started the run: then it has the message, whatever happens next.
  const started = useRef(false);
  // Enter pressed before the conversation finished loading: send once it has.
  const sendWhenLoaded = useRef(false);
  const bottom = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);

  const refresh = useCallback(async () => {
    const [approvals, log] = await Promise.all([
      api<{ mode: Mode; planning: boolean; pending: PendingApproval[] }>(
        `/threads/${threadId}/approvals`,
      ),
      api<{ receipts: Receipt[]; snapshots: Snapshot[] }>(
        `/threads/${threadId}/receipts`,
      ),
    ]);
    setPending(approvals.pending);
    setPlanning(approvals.planning);
    setReceipts(log.receipts);
    setSnapshots(log.snapshots);
  }, [threadId]);

  useEffect(() => {
    void refresh().catch(() => undefined);
  }, [refresh]);

  useEffect(() => {
    const events = agent.subscribe({
      onRunErrorEvent: ({ event }) => {
        setError(
          event.code === 'model-not-configured'
            ? t('chat.error.model-not-configured')
            : t('chat.error', { error: event.message }),
        );
      },
      onRunStartedEvent: () => {
        started.current = true;
      },
      onRunFailed: ({ error }) => {
        failed.current = error;
      },
      // Only a live run sends state: the server leaves it out of replayed history (ADR 0030),
      // so a page that reconnects to a running turn also sees its new questions.
      onStateSnapshotEvent: ({ event }) => {
        const state = event.snapshot as {
          planning?: boolean;
          pendingApprovals?: PendingApproval[];
        };
        if (state.pendingApprovals) setPending(state.pendingApprovals);
        if (state.planning !== undefined) setPlanning(state.planning);
      },
    });
    return () => events.unsubscribe();
  }, [agent, t]);

  useEffect(() => {
    if (!isReady) return;
    let active = true;
    setLoaded(false);
    sendWhenLoaded.current = false;
    void copilotkit
      .connectAgent({ agent })
      .then(() => {
        if (!active) return;
        setLoaded(true);
        // connect returns once a running turn has finished: read what it left behind.
        void refresh().catch(() => undefined);
      })
      .catch(() => active && setError(t('chat.connectError')));
    return () => {
      active = false;
    };
  }, [agent, copilotkit, isReady, refresh, t]);

  // A turn that just finished well shows Roko's jump for a moment.
  const [justDone, setJustDone] = useState(false);
  useEffect(() => {
    if (!justDone) return;
    const timer = setTimeout(() => setJustDone(false), 3000);
    return () => clearTimeout(timer);
  }, [justDone]);

  const roko: RokoState =
    pending.length > 0
      ? 'waiting'
      : error
        ? 'failed'
        : running
          ? 'running'
          : justDone
            ? 'done'
            : 'idle';

  // Tell the user when Rocky starts waiting while the window is in the background.
  const waitingCount = useRef(0);
  useEffect(() => {
    if (
      pending.length > waitingCount.current &&
      document.hidden &&
      'Notification' in window &&
      Notification.permission === 'granted'
    ) {
      new Notification(t('approval.notify'));
    }
    waitingCount.current = pending.length;
  }, [pending.length, t]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' });
  }, [agent.messages.length, running, pending.length]);

  const send = async () => {
    const text = draft.trim();
    if (!text || running) return;
    if (!loaded) {
      sendWhenLoaded.current = true;
      return;
    }
    if ('Notification' in window && Notification.permission === 'default') {
      void Notification.requestPermission().catch(() => undefined);
    }
    setError('');
    setRunning(true);
    setDraft('');
    const before = [...agent.messages];
    agent.addMessage({ id: crypto.randomUUID(), role: 'user', content: text });
    failed.current = undefined;
    started.current = false;
    try {
      await copilotkit.runAgent({ agent });
      if (failed.current === undefined) setJustDone(true);
      else {
        const failure = runFailure(failed.current);
        setError(t(failure.key, failure.params));
        if (!started.current) {
          // The server never took the message: take it back and give the text back,
          // ahead of anything typed since.
          agent.setMessages(before);
          setDraft((typed) => (typed.trim() ? `${text}\n${typed}` : text));
        }
      }
    } catch (e) {
      setError(t('chat.error', { error: e instanceof Error ? e.message : '' }));
    } finally {
      setRunning(false);
      onActivity();
      void refresh().catch(() => undefined);
    }
  };

  useEffect(() => {
    if (!loaded || !sendWhenLoaded.current) return;
    sendWhenLoaded.current = false;
    void send();
    // Only the moment loading finishes matters; send reads the current draft.
  }, [loaded]);

  const answer = async (approval: PendingApproval, choice: Answer) => {
    try {
      await api(`/approvals/${approval.id}`, 'POST', {
        ...choice,
        contentHash: approval.contentHash,
      });
    } catch (e) {
      // Already answered or gone (another tab, a restart): show what is waiting now.
      if (e instanceof ApiError && e.status === 409) {
        await refresh();
        return;
      }
      throw e;
    }
    setPending((list) => list.filter((a) => a.id !== approval.id));
  };

  // The approval mode is one setting for every conversation (also in Settings).
  const changeMode = (next: Mode) => {
    void api<Settings>('/settings/mode', 'PUT', { mode: next })
      .then(onSettings)
      .catch(() => undefined);
  };

  // Plan mode is per conversation; it turns off by itself when the user picks a plan.
  const togglePlanning = () => {
    const next = !planning;
    setPlanning(next);
    void api(`/threads/${threadId}/plan`, 'PUT', { planning: next }).catch(() =>
      refresh(),
    );
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter while an IME is composing (Chinese input) picks a candidate; it must not send.
    if (
      event.key === 'Enter' &&
      !event.shiftKey &&
      !event.nativeEvent.isComposing
    ) {
      event.preventDefault();
      void send();
    }
  };

  const messages = agent.messages;
  const results = new Map<string, string>();
  for (const m of messages) {
    if (m.role === 'tool') results.set(m.toolCallId, textOf(m.content));
  }
  const lastUser = messages.findLastIndex((m) => m.role === 'user');
  const toolCallsOf = (m: (typeof messages)[number]): ToolCall[] =>
    m.role === 'assistant' ? ((m.toolCalls ?? []) as ToolCall[]) : [];

  // Each run's change card goes at the end of the turn that holds its last tool call.
  const { at: cardsAt, unanchored } = placeChangeCards(
    messages,
    runsWithChanges(receipts, snapshots),
  );
  const unknown = receipts.filter((r) => r.outcome === 'unknown');
  const visible = messages.some(
    (m) =>
      m.role === 'user' ||
      (m.role === 'assistant' &&
        (textOf(m.content).trim() || toolCallsOf(m).length > 0)),
  );

  return (
    <main className="chat">
      <h1 className="sr-only">{t('nav.chat')}</h1>
      <div className="transcript" aria-live="polite">
        {loaded && !visible && (
          <div className="empty">
            <Roko state="waving" size={176} follow />
            <p>{t('chat.empty')}</p>
            <div className="starters">
              {STARTERS.map((key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => {
                    setDraft(t(key));
                    input.current?.focus();
                  }}
                >
                  {t(key)}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((message, index) => {
          const cards = (cardsAt.get(index) ?? []).map((card) => (
            <TurnChanges
              key={card.runId}
              threadId={threadId}
              runId={card.runId}
              count={card.count}
              project={project}
              onRestored={() => void refresh().catch(() => undefined)}
            />
          ));
          if (message.role === 'user') {
            return (
              <div key={message.id} className="turn-part">
                <div className="bubble user" aria-label={t('chat.you')}>
                  {textOf(message.content)}
                </div>
                {cards}
              </div>
            );
          }
          if (message.role !== 'assistant') {
            return cards.length ? <div key={message.id}>{cards}</div> : null;
          }
          const text = textOf(message.content).trim();
          const calls = toolCallsOf(message);
          if (!text && calls.length === 0 && cards.length === 0) return null;
          return (
            <div key={message.id} className="turn-part">
              {text && (
                <div className="reply">
                  <Roko state="idle" size={36} />
                  <div className="markdown">
                    <ReactMarkdown components={markdownComponents}>
                      {textOf(message.content)}
                    </ReactMarkdown>
                  </div>
                </div>
              )}
              {calls.length > 0 && (
                <div className="tool-cards">
                  {calls.map((call) => {
                    const result = results.get(call.id);
                    const state: ToolState =
                      result !== undefined
                        ? 'done'
                        : running && index > lastUser
                          ? pending.length > 0
                            ? 'waiting'
                            : 'running'
                          : 'interrupted';
                    return (
                      <ToolCard
                        key={call.id}
                        name={call.function.name}
                        args={call.function.arguments}
                        result={result}
                        state={state}
                      />
                    );
                  })}
                </div>
              )}
              {cards}
            </div>
          );
        })}
        {loaded &&
          !running &&
          unanchored.map((card) => (
            <TurnChanges
              key={card.runId}
              threadId={threadId}
              runId={card.runId}
              count={card.count}
              project={project}
              onRestored={() => void refresh().catch(() => undefined)}
            />
          ))}
        {unknown.map((receipt) => (
          <UnknownOutcome
            key={receipt.id}
            receipt={receipt}
            project={project}
            onConfirmed={() => void refresh().catch(() => undefined)}
            onRetry={(prompt) => {
              setDraft(prompt);
              input.current?.focus();
            }}
          />
        ))}
        <JobCards threadId={threadId} refreshKey={agent.messages.length} />
        {running && pending.length === 0 && (
          <p className="thinking">{t('chat.thinking')}</p>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div ref={bottom} />
      </div>
      {visible && (
        <div className={`presence-bar ${roko}`} role="status">
          <Roko state={roko} size={36} follow />
          <span>
            {t(
              roko === 'waiting'
                ? 'panel.waiting'
                : roko === 'done'
                  ? 'panel.done'
                  : roko === 'running'
                    ? 'panel.running'
                    : roko === 'failed'
                      ? 'panel.failed'
                      : 'panel.idle',
            )}
          </span>
        </div>
      )}
      {pending.length > 0 ? (
        <div className="composer">
          {pending[0]!.effect.kind === 'plan' ? (
            <PlanPanel
              approval={pending[0]!}
              more={pending.length - 1}
              onAnswer={answer}
              onStop={() => copilotkit.stopAgent({ agent })}
            />
          ) : (
            <ApprovalPanel
              approvals={pending}
              project={project}
              onAnswer={answer}
              onStop={() => copilotkit.stopAgent({ agent })}
            />
          )}
        </div>
      ) : (
        <form
          className="composer"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <div className="composer-box">
            <textarea
              ref={input}
              value={draft}
              rows={2}
              placeholder={t(
                planning
                  ? 'chat.placeholder.plan'
                  : coarsePointer
                    ? 'chat.placeholder.touch'
                    : 'chat.placeholder',
              )}
              aria-label={t('chat.placeholder')}
              aria-keyshortcuts="/"
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={onKeyDown}
            />
            <div className="composer-bar">
              <ModeSelect value={mode} onChange={changeMode} />
              <button
                type="button"
                className={`plan-toggle${planning ? ' on' : ''}`}
                aria-pressed={planning}
                title={t('plan.toggle.hint')}
                onClick={togglePlanning}
              >
                <ListChecks size={14} />
                {t('plan.toggle')}
              </button>
              <button
                type="button"
                className="chip"
                title={project ?? undefined}
                aria-label={`${t('panel.project')}: ${project ?? t('project.none')}`}
                onClick={onOpenSettings}
              >
                <FolderOpen size={13} aria-hidden="true" />
                <span>
                  {project
                    ? (project.split(/[\\/]/).filter(Boolean).pop() ?? project)
                    : t('project.none')}
                </span>
              </button>
              {model && (
                <span className="chip model" title={model}>
                  <Cpu size={13} aria-hidden="true" />
                  <span className="sr-only">{t('panel.model')}: </span>
                  <span>{model}</span>
                </span>
              )}
              <span className="spacer" />
              {running ? (
                <button
                  type="button"
                  className="secondary stop"
                  onClick={() => copilotkit.stopAgent({ agent })}
                >
                  <CircleStop size={15} aria-hidden="true" />
                  {t('chat.stop')}
                </button>
              ) : (
                <button
                  type="submit"
                  className="icon-button primary"
                  aria-label={t('chat.send')}
                  disabled={!draft.trim() || !loaded}
                >
                  <ArrowUp size={16} />
                </button>
              )}
            </div>
          </div>
        </form>
      )}
    </main>
  );
}
