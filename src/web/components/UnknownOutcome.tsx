// An action whose outcome Rocky could not tell. Rocky never redoes it on its own.
import { api, type Receipt } from '../api.ts';
import { effectSummary } from '../effects.ts';
import { useI18n } from '../i18n/index.tsx';

export function UnknownOutcome({
  receipt,
  project,
  onConfirmed,
  onRetry,
}: {
  receipt: Receipt;
  project: string | null;
  onConfirmed: () => void;
  onRetry: (prompt: string) => void;
}) {
  const { t } = useI18n();
  const action = effectSummary(t, receipt.effect, project);
  return (
    <div className="unknown-outcome" role="status">
      <p>
        {t('receipt.unknown', { action })}
        {receipt.detail && (
          <span className="small muted">
            {t('receipt.unknownDetail', { detail: receipt.detail })}
          </span>
        )}
      </p>
      <div className="row">
        <button
          type="button"
          className="secondary"
          onClick={() =>
            void api(`/receipts/${receipt.id}/confirm`, 'POST', {}).then(
              onConfirmed,
            )
          }
        >
          {t('receipt.confirm')}
        </button>
        <button
          type="button"
          className="secondary"
          onClick={() => onRetry(t('receipt.retryPrompt', { action }))}
        >
          {t('receipt.retry')}
        </button>
      </div>
    </div>
  );
}
