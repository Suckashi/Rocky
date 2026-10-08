// A document change: the Markdown diff inline, and its layout (before and after) in the
// preview side panel.
import { PanelRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { useI18n } from '../i18n/index.tsx';
import { useOpenPreview, type PreviewTarget } from './PreviewPane.tsx';

export function DocumentChange({
  diff,
  target,
}: {
  /** The text diff. */
  diff: ReactNode;
  target: PreviewTarget;
}) {
  const { t } = useI18n();
  const open = useOpenPreview();
  return (
    <div className="doc-change">
      <button type="button" className="secondary" onClick={() => open(target)}>
        <PanelRight size={14} />
        {t('preview.layout')}
      </button>
      {diff}
    </div>
  );
}
