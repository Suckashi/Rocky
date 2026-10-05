// Jobs handed to an external agent: list, and a detail view with Rocky's verification,
// the timeline, the diff, and apply / discard / restore.
import { useCallback, useEffect, useState } from 'react';
import {
  api,
  ApiError,
  type ApplyItem,
  type Job,
  type JobEvent,
  type Receipt,
} from '../api.ts';
import { Diff } from '../components/Diff.tsx';
import { Roko } from '../components/Roko.tsx';
import { TurnChanges } from '../components/TurnChanges.tsx';
import { useI18n, type MessageKey } from '../i18n/index.tsx';
import { commandLine } from '../effects.ts';

function UnifiedDiff({ text }: { text: string }) {
  return (
    <pre className="diff">
      {text.split('\n').map((line, index) => (
        <div
          key={index}
          className={
            line.startsWith('+') && !line.startsWith('+++')
              ? 'diff-add'
              : line.startsWith('-') && !line.startsWith('---')
                ? 'diff-del'
                : line.startsWith('@@') || line.startsWith('diff ')
                  ? 'diff-gap'
                  : ''
          }
        >
          {line}
        </div>
      ))}
    </pre>
  );
}

function Timeline({ events }: { events: JobEvent[] }) {
  const { t } = useI18n();
  return (
    <ol className="timeline">
      {events.map((e, index) => {
        let label: string;
        let body: string | null = null;
        switch (e.type) {
          case 'prompt':
            label = t('jobs.event.prompt');
            body = e.text;
            break;
          case 'message':
            label = t('jobs.event.message');
            body = e.text;
            break;
          case 'thought':
            label = t('jobs.event.thought');
            body = e.text;
            break;
          case 'tool':
            label = t('jobs.event.tool', { title: e.title, status: e.status });
            break;
          case 'permission':
            label = t(
              e.decision === 'allow' ? 'jobs.event.allow' : 'jobs.event.reject',
              { title: e.title },
            );
            break;
          case 'status':
            label = t('jobs.event.status', { text: e.text });
            break;
        }
        return (
          <li key={index} className={`event ${e.type}`}>
            <span className="small muted">
              {new Date(e.at).toLocaleTimeString()}
            </span>
            <strong className="small">{label}</strong>
            {body && <p className="event-body">{body}</p>}
          </li>
        );
      })}
    </ol>
  );
}

function JobDetail({
  id,
  project,
  onChanged,
}: {
  id: string;
  project: string | null;
  onChanged: () => void;
}) {
  const { t } = useI18n();
  const [detail, setDetail] = useState<{
    job: Job;
    events: JobEvent[];
    receipts: Receipt[];
  } | null>(null);
  const [plan, setPlan] = useState<ApplyItem[] | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setDetail(await api(`/jobs/${id}`));
  }, [id]);

  useEffect(() => {
    setPlan(null);
    setMessage('');
    void load().catch(() => undefined);
  }, [load]);

  // A running job updates its timeline as it goes.
  const running = detail?.job.status === 'running';
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => void load().catch(() => undefined), 1500);
    return () => clearInterval(timer);
  }, [running, load]);

  const errorText = (e: unknown) => {
    const code = e instanceof Error ? e.message : '';
    return e instanceof ApiError &&
      [
        'project-changed',
        'content-changed',
        'not-applicable',
        'denied',
      ].includes(code)
      ? t(`jobs.error.${code}` as MessageKey, { path: '' })
      : t('jobs.actionError', { error: code });
  };

  const act = async (fn: () => Promise<void>) => {
    setBusy(true);
    setMessage('');
    try {
      await fn();
    } catch (e) {
      setMessage(errorText(e));
    } finally {
      setBusy(false);
      await load().catch(() => undefined);
      onChanged();
    }
  };

  if (!detail) return null;
  const { job, events } = detail;
  const r = job.result;
  const canApply = job.status === 'verified' || job.status === 'problems';
  const canDiscard = !['running', 'applied', 'discarded'].includes(job.status);

  return (
    <article className="job-detail">
      <header className="job-head">
        <div>
          <h2>{job.title}</h2>
          <span className="small muted">
            {t('jobs.agent', { agent: 'OpenCode' })} ·{' '}
            {new Date(job.createdAt).toLocaleString()}
          </span>
        </div>
        <span className={`badge status-${job.status}`}>
          {t(`jobs.status.${job.status}`)}
        </span>
      </header>

      <section className="card">
        <h3>{t('jobs.task')}</h3>
        <p className="pre">{job.task}</p>
        {r?.summary && (
          <>
            <h3>{t('jobs.summary')}</h3>
            <p className="pre">{r.summary}</p>
          </>
        )}
      </section>

      {r && (
        <section className="card">
          <h3>{t('jobs.verification')}</h3>
          {r.error && (
            <p className="error pre">{t('jobs.error', { error: r.error })}</p>
          )}
          {r.warnings.map((w) => (
            <p key={w} className="warn small">
              {t(`jobs.warning.${w}` as MessageKey)}
            </p>
          ))}
          <p>
            {r.changed.length
              ? t('jobs.changed', { count: r.changed.length })
              : t('jobs.noChanges')}
          </p>
          {r.changed.length > 0 && (
            <ul className="mono small">
              {r.changed.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          )}
          {r.unapproved.length > 0 && (
            <p className="error">
              {t('jobs.unapproved', { files: r.unapproved.join(', ') })}
            </p>
          )}
          {r.mismatched.length > 0 && (
            <p className="error">
              {t('jobs.mismatched', { files: r.mismatched.join(', ') })}
            </p>
          )}
          {r.changed.length > 0 &&
            r.unapproved.length === 0 &&
            r.mismatched.length === 0 && (
              <p className="ok">{t('jobs.matches')}</p>
            )}
          {r.checks.length === 0 && r.changed.length > 0 && (
            <p className="small muted">{t('jobs.checkNone')}</p>
          )}
          {r.checks.map((c, i) => (
            <details key={i} className="check">
              <summary className={c.exitCode === 0 ? 'ok' : 'error'}>
                {t('jobs.check', {
                  command: commandLine(c.argv),
                  code: c.exitCode ?? '—',
                })}
              </summary>
              <pre className="code">{c.output}</pre>
            </details>
          ))}
        </section>
      )}

      {(canApply || canDiscard) && (
        <section className="card">
          {job.status === 'problems' && (
            <p className="warn small">{t('jobs.problemsApply')}</p>
          )}
          <div className="row">
            {canApply && (
              <button
                type="button"
                className="primary"
                disabled={busy || (r?.changed.length ?? 0) === 0}
                onClick={() =>
                  void act(async () => {
                    setPlan(
                      (await api<{ items: ApplyItem[] }>(`/jobs/${id}/apply`))
                        .items,
                    );
                  })
                }
              >
                {t('jobs.apply')}
              </button>
            )}
            {canDiscard && (
              <button
                type="button"
                className="secondary"
                disabled={busy}
                onClick={() => {
                  if (!window.confirm(t('jobs.discardConfirm'))) return;
                  void act(async () => {
                    await api(`/jobs/${id}/discard`, 'POST', {});
                  });
                }}
              >
                {t('jobs.discard')}
              </button>
            )}
          </div>
          {plan && (
            <div className="change-list">
              <strong>{t('jobs.applyTitle')}</strong>
              {plan.map((item) => (
                <div key={item.path} className="change">
                  <div className="row">
                    <span className="badge">
                      {t(
                        item.operation === 'create'
                          ? 'changes.created'
                          : item.operation === 'delete'
                            ? 'changes.deleted'
                            : 'changes.edited',
                      )}
                    </span>
                    <span className="mono small">{item.path}</span>
                  </div>
                  {item.modifiedSince && (
                    <p className="warn small">{t('changes.modifiedSince')}</p>
                  )}
                  <Diff before={item.before} after={item.after} />
                </div>
              ))}
              <div className="row end">
                <button
                  type="button"
                  className="secondary"
                  onClick={() => setPlan(null)}
                >
                  {t('changes.cancel')}
                </button>
                <button
                  type="button"
                  className="primary"
                  disabled={busy}
                  onClick={() =>
                    void act(async () => {
                      const result = await api<{ applied: string[] }>(
                        `/jobs/${id}/apply`,
                        'POST',
                        {
                          items: plan.map(({ path, contentHash }) => ({
                            path,
                            contentHash,
                          })),
                        },
                      );
                      setPlan(null);
                      setMessage(
                        t('jobs.applied', { count: result.applied.length }),
                      );
                    })
                  }
                >
                  {t('jobs.applyConfirm')}
                </button>
              </div>
            </div>
          )}
        </section>
      )}

      {job.status === 'applied' && (
        <section className="card">
          <h3>{t('jobs.restoreApplied')}</h3>
          <TurnChanges
            threadId={job.threadId}
            runId={`apply:${job.id}`}
            count={r?.changed.length ?? 0}
            project={project}
            onRestored={onChanged}
          />
        </section>
      )}

      {message && (
        <p className="small" role="status">
          {message}
        </p>
      )}

      {r?.diff && (
        <section className="card">
          <h3>{t('jobs.diff')}</h3>
          <UnifiedDiff text={r.diff} />
        </section>
      )}

      <section className="card">
        <h3>{t('jobs.timeline')}</h3>
        <Timeline events={events} />
      </section>

      <a className="link" href={`#/t/${job.threadId}`}>
        {t('jobs.openChat')}
      </a>
    </article>
  );
}

export function JobsPage({
  selected,
  project,
  onSelect,
}: {
  selected: string | undefined;
  project: string | null;
  onSelect: (id: string) => void;
}) {
  const { t } = useI18n();
  const [list, setList] = useState<{ available: boolean; jobs: Job[] } | null>(
    null,
  );
  const load = useCallback(() => {
    void api<{ available: boolean; jobs: Job[] }>('/jobs')
      .then(setList)
      .catch(() => undefined);
  }, []);
  useEffect(load, [load]);
  const anyRunning = list?.jobs.some((j) => j.status === 'running');
  useEffect(() => {
    if (!anyRunning) return;
    const timer = setInterval(load, 2000);
    return () => clearInterval(timer);
  }, [anyRunning, load]);

  return (
    <>
      <aside className="threads" aria-label={t('jobs.title')}>
        <span className="label">{t('jobs.title')}</span>
        {list && !list.available && (
          <p className="small warn">{t('jobs.unavailable')}</p>
        )}
        {list?.jobs.length === 0 && (
          <p className="small muted">{t('jobs.empty')}</p>
        )}
        <ul>
          {list?.jobs.map((job) => (
            <li key={job.id} className={job.id === selected ? 'active' : ''}>
              <button
                type="button"
                className="thread job-item"
                onClick={() => onSelect(job.id)}
              >
                <span>{job.title}</span>
                <span className={`badge status-${job.status}`}>
                  {t(`jobs.status.${job.status}`)}
                </span>
              </button>
            </li>
          ))}
        </ul>
        <p className="small muted">{t('jobs.network')}</p>
      </aside>
      <main className="jobs-main">
        {selected ? (
          <JobDetail
            key={selected}
            id={selected}
            project={project}
            onChanged={load}
          />
        ) : (
          <div className="empty">
            <Roko state="idle" size={120} />
            <p>{t('jobs.select')}</p>
          </div>
        )}
      </main>
    </>
  );
}
