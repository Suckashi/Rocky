import { RotateCw } from 'lucide-react';
import { CodeBlock } from '../components/CodeBlock.tsx';
import { Roko } from '../components/Roko.tsx';
import { useI18n } from '../i18n/index.tsx';

/** Shown when the API answers 401: this tab was not opened through the launcher. */
export function Locked() {
  const { t } = useI18n();
  return (
    <main className="centered">
      <Roko state="waiting" size={140} />
      <h1>{t('locked.title')}</h1>
      <p>{t('locked.body')}</p>
      <div className="actions">
        <CodeBlock inline>{t('locked.command')}</CodeBlock>
        <button
          type="button"
          className="secondary"
          onClick={() => window.location.reload()}
        >
          <RotateCw size={15} aria-hidden="true" />
          {t('locked.retry')}
        </button>
      </div>
    </main>
  );
}
