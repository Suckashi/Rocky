// The background jobs this conversation started: where each one stands, and once it is done,
// the result Rocky verified itself (files changed, its own checks), with a way to apply it.
// Written by Rocky from the job's record, not by the model, so it costs no model call and
// never claims more than Rocky checked.
import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.ts';
import { useI18n, type MessageKey } from '../i18n/index.tsx';

export interface ThreadJob {
  id: string;
  title: string;
  status: string;
  position: number | null;
  waiting: number;
  changed: number;
  checksPassed: boolean | null;
  finishedAt: number | null;
}

const HIDDEN_KEY = 'rocky.hiddenJobCards';
function hiddenJobs(): Set<string> {
  try {
    return new Set(
      JSON.parse(localStorage.getItem(HIDDEN_KEY) ?? '[]') as string[],
    );
  } catch {
    return new Set();
  }
}

export function JobCards({
  threadId,
  refreshKey,
}: {
  threadId: string;
  /** Changes when a turn ends, so a job delegated in it shows up at once. */
  refreshKey: number;
}) {
  const { t } = useI18n();
  const [jobs, setJobs] = useState<ThreadJob[]>([]);
  const [hidden, setHidden] = useState(hiddenJobs);

  const load = useCallback(
    () =>
      void api<{ jobs: ThreadJob[] }>(`/threads/${threadId}/jobs`)
        .then((r) => setJobs(r.jobs))
        .catch(() => undefined),
    [threadId],
  );
  useEffect(load, [load, refreshKey]);
  const active = jobs.some(
    (j) => j.status === 'queued' || j.status === 'running',
  );
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(load, 3000);
    return () => clearInterval(timer);
  }, [active, load]);

  const hide = (id: string) => {
    const next = new Set(hidden).add(id);
    setHidden(next);
    try {
      localStorage.setItem(HIDDEN_KEY, JSON.stringify([...next].slice(-200)));
    } catch {
      // Not remembered after a reload; the card is hidden for now.
    }
  };

  const shown = jobs.filter((j) => !hidden.has(j.id));
  if (shown.length === 0) return null;
  return (
    <section className="job-cards" aria-label={t('jobCard.region')}>
      {shown.map((job) => {
        const done = job.status !== 'queued' && job.status !== 'running';
        const canApply = job.status === 'verified' || job.status === 'problems';
        return (
          <div key={job.id} className={`job-card status-${job.status}`}>
            <div className="row">
              <strong>{t('jobCard.title', { title: job.title })}</strong>
              <span className={`badge status-${job.status}`}>
                {job.waiting
                  ? t('jobs.waiting', { count: job.waiting })
                  : t(`jobs.status.${job.status}` as MessageKey)}
              </span>
            </div>
            <p className="small muted">
              {!done
                ? job.position
                  ? t('jobs.queuedAt', { position: job.position })
                  : t('jobCard.running')
                : [
                    job.changed
                      ? t('jobs.changed', { count: job.changed })
                      : t('jobs.noChanges'),
                    job.checksPassed === null
                      ? t('jobCard.noChecks')
                      : t(
                          job.checksPassed
                            ? 'jobCard.checksPassed'
                            : 'jobCard.checksFailed',
                        ),
                  ].join(' · ')}
            </p>
            <div className="row">
              <a className="link small" href={`#/jobs/${job.id}`}>
                {t('jobs.view')}
              </a>
              {canApply && job.changed > 0 && (
                <a
                  className="button primary small"
                  href={`#/jobs/${job.id}/apply`}
                >
                  {t('jobs.apply')}
                </a>
              )}
              <span className="spacer" />
              {done && (
                <button
                  type="button"
                  className="link small"
                  onClick={() => hide(job.id)}
                >
                  {t('jobCard.dismiss')}
                </button>
              )}
            </div>
          </div>
        );
      })}
    </section>
  );
}
