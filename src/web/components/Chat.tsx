// One conversation: history from the local runner, streaming reply, stop, errors.
import { useAgent, useCopilotKit } from '@copilotkit/react-core/v2';
import { ArrowUp, Square } from 'lucide-react';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import ReactMarkdown from 'react-markdown';
import { useI18n } from '../i18n/index.tsx';
import { Roko, type RokoState } from './Roko.tsx';

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

export function Chat({
  threadId,
  onActivity,
  onState,
}: {
  threadId: string;
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
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const events = agent.subscribe({
      onRunErrorEvent: ({ event }) => {
        setError(
          event.code === 'model-not-configured'
            ? t('chat.error.model-not-configured')
            : t('chat.error', { error: event.message }),
        );
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

  useEffect(() => {
    onState(error ? 'failed' : running ? 'running' : 'idle');
  }, [error, running, onState]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' });
  }, [agent.messages.length, running]);

  const send = async () => {
    const text = draft.trim();
    if (!text || running || !loaded) return;
    setError('');
    setRunning(true);
    setDraft('');
    agent.addMessage({ id: crypto.randomUUID(), role: 'user', content: text });
    try {
      await copilotkit.runAgent({ agent });
    } catch (e) {
      setError(t('chat.error', { error: e instanceof Error ? e.message : '' }));
    } finally {
      setRunning(false);
      onActivity();
    }
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

  const messages = agent.messages.filter(
    (m) =>
      (m.role === 'user' || m.role === 'assistant') && textOf(m.content).trim(),
  );

  return (
    <section className="chat">
      <div className="transcript" aria-live="polite">
        {loaded && messages.length === 0 && (
          <div className="empty">
            <Roko state="waving" size={120} />
            <p>{t('chat.empty')}</p>
          </div>
        )}
        {messages.map((message) =>
          message.role === 'user' ? (
            <div
              key={message.id}
              className="bubble user"
              aria-label={t('chat.you')}
            >
              {textOf(message.content)}
            </div>
          ) : (
            <div key={message.id} className="reply">
              <Roko state="idle" size={32} />
              <div className="markdown">
                <ReactMarkdown
                  components={{
                    img: ({ alt }) => <span>{alt}</span>,
                    a: ({ href, children }) => (
                      <a href={href} target="_blank" rel="noreferrer">
                        {children}
                      </a>
                    ),
                  }}
                >
                  {textOf(message.content)}
                </ReactMarkdown>
              </div>
            </div>
          ),
        )}
        {running && <p className="thinking">{t('chat.thinking')}</p>}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div ref={bottom} />
      </div>
      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <textarea
          value={draft}
          rows={2}
          placeholder={t('chat.placeholder')}
          aria-label={t('chat.placeholder')}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
        />
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
      </form>
    </section>
  );
}
