// Conversation list from the local runner (CopilotKit's thread endpoints).
import { useThreads } from '@copilotkit/react-core/v2';
import { Plus, Trash2, X } from 'lucide-react';
import { useEffect } from 'react';
import { api } from '../api.ts';
import { useI18n } from '../i18n/index.tsx';

export function ThreadList({
  selected,
  onSelect,
  onNew,
  refreshKey,
  onClose,
}: {
  selected: string;
  onSelect: (id: string) => void;
  onNew: () => void;
  refreshKey: number;
  /** Closes the list where it is a drawer (narrow windows). */
  onClose?: () => void;
}) {
  const { t } = useI18n();
  const threads = useThreads({
    agentId: 'rocky',
    includeArchived: false,
    limit: 50,
  });
  const { refetchThreads } = threads;
  useEffect(() => {
    refetchThreads();
  }, [refreshKey, refetchThreads]);

  const remove = async (id: string) => {
    if (!window.confirm(t('threads.delete.confirm'))) return;
    await api(`/threads/${encodeURIComponent(id)}`, 'DELETE', {});
    refetchThreads();
    if (id === selected) onNew();
  };

  return (
    <aside className="threads" aria-label={t('nav.threads')}>
      <div className="threads-top">
        <button
          type="button"
          className="new-thread"
          title={t('threads.newHint')}
          aria-keyshortcuts="Control+Shift+O Meta+Shift+O"
          onClick={onNew}
        >
          <Plus size={16} />
          {t('threads.new')}
        </button>
        {onClose && (
          <button
            type="button"
            className="icon-button drawer-close"
            aria-label={t('threads.close')}
            onClick={onClose}
          >
            <X size={16} />
          </button>
        )}
      </div>
      <span className="label">{t('threads.recent')}</span>
      {threads.error && <p className="bad small">{t('threads.loadError')}</p>}
      {threads.threads.length === 0 && !threads.isLoading && (
        <p className="muted small">{t('threads.empty')}</p>
      )}
      <ul>
        {threads.threads.map((thread) => (
          <li
            key={thread.id}
            className={thread.id === selected ? 'active' : ''}
          >
            <button
              type="button"
              className="thread"
              onClick={() => onSelect(thread.id)}
            >
              {thread.name || t('threads.untitled')}
            </button>
            <button
              type="button"
              className="icon-button ghost"
              aria-label={t('threads.delete')}
              onClick={() => void remove(thread.id)}
            >
              <Trash2 size={14} />
            </button>
          </li>
        ))}
      </ul>
    </aside>
  );
}
