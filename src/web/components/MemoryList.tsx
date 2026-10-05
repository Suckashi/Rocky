// Saved memories in Settings: read them, delete one (through the gate, so it is receipted).
import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.ts';
import { useI18n } from '../i18n/index.tsx';

interface MemoryItem {
  file: string;
  title: string;
  content: string;
  updatedAt: number;
  deleteHash: string;
}

export function MemoryList() {
  const { t } = useI18n();
  const [data, setData] = useState<{
    dir: string;
    memories: MemoryItem[];
  } | null>(null);
  const [error, setError] = useState('');
  const load = useCallback(() => {
    void api<{ dir: string; memories: MemoryItem[] }>('/memory')
      .then(setData)
      .catch(() => undefined);
  }, []);
  useEffect(load, [load]);

  const remove = async (m: MemoryItem) => {
    if (!window.confirm(t('memory.deleteConfirm', { title: m.title }))) return;
    try {
      await api('/memory/delete', 'POST', {
        file: m.file,
        contentHash: m.deleteHash,
      });
      setError('');
    } catch (e) {
      setError(
        t('memory.error', { error: e instanceof Error ? e.message : '' }),
      );
    }
    load();
  };

  if (!data) return null;
  return (
    <div className="memory-list">
      <p className="small muted">{t('memory.hint')}</p>
      <p className="small muted mono">{data.dir}</p>
      {data.memories.length === 0 && (
        <p className="small muted">{t('memory.empty')}</p>
      )}
      {data.memories.map((m) => (
        <details key={m.file} className="memory">
          <summary>
            <strong>{m.title}</strong>
            <span className="small muted">
              {new Date(m.updatedAt).toLocaleString()}
            </span>
          </summary>
          <pre className="code">{m.content}</pre>
          <div className="row end">
            <button
              type="button"
              className="secondary"
              onClick={() => void remove(m)}
            >
              {t('memory.delete')}
            </button>
          </div>
        </details>
      ))}
      {error && (
        <p className="error small" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
