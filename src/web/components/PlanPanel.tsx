// The plan at the end of plan mode (ADR 0019): Rocky offers up to three ways to do the task.
// Choosing one turns plan mode off and starts the work; "ask for changes" sends feedback;
// Esc rejects.
import { Square } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { PendingApproval, PlanOption } from '../api.ts';
import { useI18n } from '../i18n/index.tsx';
import type { Answer } from './ApprovalPanel.tsx';

export function PlanPanel({
  approval,
  more,
  onAnswer,
  onStop,
}: {
  approval: PendingApproval;
  more: number;
  onAnswer: (approval: PendingApproval, answer: Answer) => Promise<void>;
  onStop: () => void;
}) {
  const { t } = useI18n();
  const effect = approval.effect as {
    kind: 'plan';
    title: string;
    options: PlanOption[];
  };
  const [revising, setRevising] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const box = useRef<HTMLTextAreaElement>(null);
  const panel = useRef<HTMLElement>(null);

  useEffect(() => {
    setRevising(false);
    setFeedback('');
    setError('');
    panel.current?.focus();
  }, [approval.id]);
  useEffect(() => {
    if (revising) box.current?.focus();
  }, [revising]);

  const send = async (answer: Answer) => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await onAnswer(approval, answer);
    } catch (e) {
      setError(
        t('approval.failed', { error: e instanceof Error ? e.message : '' }),
      );
    } finally {
      setBusy(false);
    }
  };

  const reviseKey = effect.options.length + 1;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.isComposing) return;
      const typing = event.target === box.current;
      if (event.key === 'Escape') {
        event.preventDefault();
        if (typing) setRevising(false);
        else void send({ decision: 'reject' });
        return;
      }
      if (typing) {
        if (event.key === 'Enter' && !event.shiftKey && feedback.trim()) {
          event.preventDefault();
          void send({ decision: 'revise', feedback: feedback.trim() });
        }
        return;
      }
      const n = Number(event.key);
      if (n >= 1 && n <= effect.options.length) {
        event.preventDefault();
        void send({ decision: 'choose', option: n - 1 });
      } else if (n === reviseKey) {
        event.preventDefault();
        setRevising(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <section
      ref={panel}
      tabIndex={-1}
      className="approval plan-panel"
      role="region"
      aria-label={t('approval.region')}
    >
      <header className="approval-head">
        <strong>
          {t('plan.title', {
            count: effect.options.length,
            title: effect.title,
          })}
        </strong>
        {more > 0 && (
          <span className="badge">{t('approval.more', { count: more })}</span>
        )}
      </header>
      <div className="plan-options">
        {effect.options.map((option, index) => (
          <button
            key={index}
            type="button"
            className="plan-option"
            disabled={busy}
            onClick={() => void send({ decision: 'choose', option: index })}
          >
            <span className="plan-option-head">
              <kbd>{index + 1}</kbd>
              <strong>{option.title}</strong>
            </span>
            {option.summary && <span className="small">{option.summary}</span>}
            <ol className="small plan-steps">
              {option.steps.map((step, i) => (
                <li key={i}>{step}</li>
              ))}
            </ol>
          </button>
        ))}
      </div>
      <p className="small muted">{t('plan.note')}</p>
      <div className="row">
        <button
          type="button"
          className="secondary"
          disabled={busy}
          onClick={() => setRevising(true)}
        >
          <kbd>{reviseKey}</kbd> {t('plan.revise')}
        </button>
        <button
          type="button"
          className="secondary"
          disabled={busy}
          onClick={() => void send({ decision: 'reject' })}
        >
          {t('plan.reject')}
        </button>
        <span className="spacer" />
        <button
          type="button"
          className="icon-button"
          aria-label={t('chat.stop')}
          onClick={onStop}
        >
          <Square size={16} />
        </button>
      </div>
      {revising && (
        <textarea
          ref={box}
          className="plan-feedback"
          rows={2}
          value={feedback}
          placeholder={t('plan.feedback')}
          aria-label={t('plan.feedback')}
          onChange={(e) => setFeedback(e.target.value)}
        />
      )}
      <span className="small muted">
        {busy ? t('approval.sending') : t('plan.keys', { revise: reviseKey })}
      </span>
      {error && (
        <span className="error small" role="alert">
          {error}
        </span>
      )}
    </section>
  );
}
