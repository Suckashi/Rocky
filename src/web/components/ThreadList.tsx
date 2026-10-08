// Conversation list from the local runner (CopilotKit's thread endpoints).
import { useThreads } from '@copilotkit/react-core/v2';
import { Plus, Trash2 } from 'lucide-react';
import { useEffect } from 'react';
import { api } from '../api.ts';
import { useI18n } from '../i18n/index.tsx';

export function ThreadList({
  selected,
  onSelect,
  onNew,
  refreshKey,
}: {
  selected: string;
  onSelect: (id: string) => void;
  onNew: () => void;
  refreshKey: number;
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
    <aside className="threads">
      <button type="button" className="new-thread" onClick={onNew}>
        <Plus size={16} />
        {t('threads.new')}
      </button>
      <div className="label">{t('threads.recent')}</div>
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
