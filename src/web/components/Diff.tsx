// A unified diff of two texts with folded unchanged lines.
import { diffLines, withContext } from '../diff.ts';
import { useI18n } from '../i18n/index.tsx';

export function Diff({
  before,
  after,
  context = 3,
}: {
  before: string | null;
  after: string | null;
  context?: number;
}) {
  const { t } = useI18n();
  const rows = withContext(diffLines(before, after), context);
  if (rows.length === 0)
    return <p className="muted small">{t('diff.empty')}</p>;
  return (
    <pre className="diff">
      {rows.map((row, index) =>
        row.kind === 'gap' ? (
          <div key={index} className="diff-gap">
            {t('diff.gap', { count: row.count })}
          </div>
        ) : (
          <div key={index} className={`diff-${row.kind}`}>
            <span className="diff-sign" aria-hidden="true">
              {row.kind === 'add' ? '+' : row.kind === 'del' ? '-' : ' '}
            </span>
            {row.text}
          </div>
        ),
      )}
    </pre>
  );
}
