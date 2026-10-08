// Installed skills in Settings. Skills are installed by hand into the folder shown.
import { useEffect, useState } from 'react';
import { api } from '../api.ts';
import { useI18n } from '../i18n/index.tsx';

export function SkillList() {
  const { t } = useI18n();
  const [data, setData] = useState<{
    dir: string;
    skills: { name: string; description: string; folder: string }[];
  } | null>(null);
  useEffect(() => {
    void api<NonNullable<typeof data>>('/skills')
      .then(setData)
      .catch(() => undefined);
  }, []);
  if (!data) return null;
  return (
    <div className="memory-list">
      <p className="small muted">{t('skills.hint')}</p>
      <p className="small muted mono">{data.dir}</p>
      {data.skills.length === 0 ? (
        <p className="small muted">{t('skills.empty')}</p>
      ) : (
        <ul className="skill-list">
          {data.skills.map((s) => (
            <li key={s.folder}>
              <strong>{s.name}</strong>
              <span className="small muted">{s.description}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
