// The project folder: the only place Rocky reads, edits and runs commands.
import { useState } from 'react';
import { api, ApiError, type Settings } from '../api.ts';
import { useI18n } from '../i18n/index.tsx';

export function ProjectForm({
  current,
  onSaved,
}: {
  current: string | null;
  onSaved: (settings: Settings) => void;
}) {
  const { t } = useI18n();
  const [path, setPath] = useState(current ?? '');
  const [status, setStatus] = useState<'idle' | 'saved' | string>('idle');

  const save = async () => {
    try {
      onSaved(
        await api<Settings>('/settings/project', 'PUT', { path: path.trim() }),
      );
      setStatus('saved');
    } catch (e) {
      const code = e instanceof Error ? e.message : '';
      setStatus(
        e instanceof ApiError && code === 'invalid-project'
          ? t('project.error.invalid-project')
          : e instanceof ApiError && code === 'project-not-found'
            ? t('project.error.project-not-found')
            : t('project.error', { error: code }),
      );
    }
  };

  return (
    <form
      className="project-form"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <p className="small muted">{t('project.hint')}</p>
      <div className="fields">
        <label>
          {t('project.label')}
          <input
            className="mono"
            value={path}
            spellCheck={false}
            placeholder={t('project.placeholder')}
            onChange={(e) => {
              setPath(e.target.value);
              setStatus('idle');
            }}
          />
        </label>
      </div>
      <div className="row end">
        {status === 'saved' ? (
          <span className="ok small">{t('project.saved')}</span>
        ) : status !== 'idle' ? (
          <span className="error small" role="alert">
            {status}
          </span>
        ) : null}
        <button type="submit" className="primary" disabled={!path.trim()}>
          {t('project.save')}
        </button>
      </div>
    </form>
  );
}
