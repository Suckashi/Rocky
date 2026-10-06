// One conversation: history from the local runner, streaming reply, tool cards, approvals
// (in place of the input box), per-turn file changes, and actions with an unknown outcome.
import { useAgent, useCopilotKit } from '@copilotkit/react-core/v2';
import { ArrowUp, Square } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import { api, type Mode, type PendingApproval, type Receipt } from '../api.ts';
import { useI18n } from '../i18n/index.tsx';
import { ApprovalPanel, type Answer } from './ApprovalPanel.tsx';
import { PlanPanel } from './PlanPanel.tsx';
import { filePreview, isPreviewable, useOpenPreview } from './PreviewPane.tsx';
import { ModeSelect } from './ModeSelect.tsx';
import { Roko, type RokoState } from './Roko.tsx';
import { ToolCard, type ToolState } from './ToolCard.tsx';
import { TurnChanges } from './TurnChanges.tsx';
import { RuleSuggestion, type Suggestion } from './RuleSuggestion.tsx';
import { UnknownOutcome } from './UnknownOutcome.tsx';

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

interface Snapshot {
  receiptId: string;
  path: string;
}

/** Files each run changed (by Rocky, not by the user's restores), and its last tool call. */
function runsWithChanges(receipts: Receipt[], snapshots: Snapshot[]) {
  const paths = new Map<string, string[]>();
  for (const s of snapshots) {
    paths.set(s.receiptId, [...(paths.get(s.receiptId) ?? []), s.path]);
  }
  const runs = new Map<string, { files: Set<string>; lastToolCall: string }>();
  for (const r of receipts) {
    if (r.actor === 'user' || r.outcome !== 'succeeded' || !r.runId) continue;
    const files = paths.get(r.id);
    if (!files || !r.toolCallId) continue;
    const run = runs.get(r.runId) ?? {
      files: new Set<string>(),
      lastToolCall: r.toolCallId,
    };
    files.forEach((f) => run.files.add(f));
    run.lastToolCall = r.toolCallId;
    runs.set(r.runId, run);
  }
  return runs;
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

export function Chat({
  threadId,
  project,
  onActivity,
  onState,
}: {
  threadId: string;
  project: string | null;
  onActivity: () => void;
  onState: (state: RokoState) => void;
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
  const [mode, setMode] = useState<Mode | null>(null);
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const runningRef = useRef(false);
  const bottom = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);

  const refresh = useCallback(async () => {
    const [approvals, log] = await Promise.all([
      api<{ mode: Mode; pending: PendingApproval[] }>(
        `/threads/${threadId}/approvals`,
      ),
      api<{ receipts: Receipt[]; snapshots: Snapshot[] }>(
        `/threads/${threadId}/receipts`,
      ),
    ]);
    setPending(approvals.pending);
    setMode(approvals.mode);
    setReceipts(log.receipts);
    setSnapshots(log.snapshots);
    // Roko's rule suggestions are a nicety: failing to load them changes nothing.
    void api<{ suggestions: Suggestion[] }>('/rules/suggestions')
      .then((r) => setSuggestions(r.suggestions))
      .catch(() => undefined);
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
      // Replayed history carries old snapshots; only a live run speaks for the present.
      onStateSnapshotEvent: ({ event }) => {
        if (!runningRef.current) return;
        const state = event.snapshot as {
          mode?: Mode;
          pendingApprovals?: PendingApproval[];
        };
        if (state.pendingApprovals) setPending(state.pendingApprovals);
        if (state.mode) setMode(state.mode);
      },
    });
    return () => events.unsubscribe();
  }, [agent, t]);

  useEffect(() => {
    if (!isReady) return;
    let active = true;
    setLoaded(false);
    void copilotkit
      .connectAgent({ agent })
      .then(() => active && setLoaded(true))
      .catch(() => active && setError(t('chat.connectError')));
    return () => {
      active = false;
    };
  }, [agent, copilotkit, isReady, t]);

  // A turn that just finished well shows Roko's jump for a moment.
  const [justDone, setJustDone] = useState(false);
  useEffect(() => {
    if (!justDone) return;
    const timer = setTimeout(() => setJustDone(false), 3000);
    return () => clearTimeout(timer);
  }, [justDone]);

  useEffect(() => {
    onState(
      pending.length > 0
        ? 'waiting'
        : error
          ? 'failed'
          : running
            ? 'running'
            : justDone
              ? 'done'
              : 'idle',
    );
  }, [error, running, pending.length, justDone, onState]);

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
  }, [agent.messages.length, running, pending.length, suggestions.length]);

  const send = async () => {
    const text = draft.trim();
    if (!text || running || !loaded) return;
    if ('Notification' in window && Notification.permission === 'default') {
      void Notification.requestPermission().catch(() => undefined);
    }
    setError('');
    setRunning(true);
    runningRef.current = true;
    setDraft('');
    agent.addMessage({ id: crypto.randomUUID(), role: 'user', content: text });
    try {
      await copilotkit.runAgent({ agent });
      setJustDone(true);
    } catch (e) {
      setError(t('chat.error', { error: e instanceof Error ? e.message : '' }));
    } finally {
      runningRef.current = false;
      setRunning(false);
      onActivity();
      void refresh().catch(() => undefined);
    }
  };

  const answer = async (approval: PendingApproval, choice: Answer) => {
    await api(`/approvals/${approval.id}`, 'POST', {
      ...choice,
      contentHash: approval.contentHash,
    });
    setPending((list) => list.filter((a) => a.id !== approval.id));
  };

  const changeMode = (next: Mode) => {
    setMode(next);
    void api(`/threads/${threadId}/mode`, 'PUT', { mode: next }).catch(() =>
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
  const cardsAt = new Map<number, { runId: string; count: number }[]>();
  for (const [runId, run] of runsWithChanges(receipts, snapshots)) {
    const anchor = messages.findIndex((m) =>
      toolCallsOf(m).some((c) => c.id === run.lastToolCall),
    );
    if (anchor < 0) continue;
    const nextUser = messages.findIndex(
      (m, i) => i > anchor && m.role === 'user',
    );
    const at = (nextUser < 0 ? messages.length : nextUser) - 1;
    cardsAt.set(at, [
      ...(cardsAt.get(at) ?? []),
      { runId, count: run.files.size },
    ]);
  }
  const unknown = receipts.filter((r) => r.outcome === 'unknown');
  const visible = messages.some(
    (m) =>
      m.role === 'user' ||
      (m.role === 'assistant' &&
        (textOf(m.content).trim() || toolCallsOf(m).length > 0)),
  );

  return (
    <section className="chat">
      <div className="transcript" aria-live="polite">
        {loaded && !visible && (
          <div className="empty">
            <Roko state="waving" size={120} />
            <p>{t('chat.empty')}</p>
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
                  <Roko state="idle" size={32} />
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
                          ? 'running'
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
        {!running && pending.length === 0 && suggestions[0] && (
          <RuleSuggestion
            key={suggestions[0].prefix.join(' ')}
            suggestion={suggestions[0]}
            onDone={() => void refresh().catch(() => undefined)}
          />
        )}
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
              placeholder={t('chat.placeholder')}
              aria-label={t('chat.placeholder')}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={onKeyDown}
            />
            <div className="composer-bar">
              {mode && <ModeSelect value={mode} onChange={changeMode} />}
              <span className="spacer" />
              {running ? (
                <button
                  type="button"
                  className="icon-button"
                  aria-label={t('chat.stop')}
                  onClick={() => copilotkit.stopAgent({ agent })}
                >
                  <Square size={16} />
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
    </section>
  );
}
