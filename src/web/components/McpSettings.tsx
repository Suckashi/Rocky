// MCP servers in Settings: add or remove a server, see whether it connected, and choose per
// tool whether calls ask (default), run as read-only, or are turned off.
import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.ts';
import { useI18n } from '../i18n/index.tsx';

type Policy = 'ask' | 'read-only' | 'deny';
const POLICIES: Policy[] = ['ask', 'read-only', 'deny'];

type Server =
  | {
      name: string;
      transport: 'stdio';
      command: string;
      args: string[];
      env: Record<string, string>;
    }
  | {
      name: string;
      transport: 'http';
      url: string;
      headers: Record<string, string>;
    };

interface Info {
  servers: Server[];
  status: {
    name: string;
    connected: boolean;
    error: string | null;
    tools: { name: string; description: string }[];
  }[];
  policies: Record<string, Policy>;
}

/** "KEY=value" lines to an object. */
const pairs = (text: string) =>
  Object.fromEntries(
    text
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.includes('='))
      .map((l) => [
        l.slice(0, l.indexOf('=')).trim(),
        l.slice(l.indexOf('=') + 1),
      ]),
  );

export function McpSettings() {
  const { t } = useI18n();
  const [info, setInfo] = useState<Info | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    name: '',
    transport: 'stdio' as 'stdio' | 'http',
    command: '',
    args: '',
    env: '',
    url: '',
  });

  const load = useCallback(() => {
    setLoading(true);
    void api<Info>('/mcp')
      .then(setInfo)
      .catch(() => undefined)
      .finally(() => setLoading(false));
  }, []);
  useEffect(load, [load]);

  const save = async (servers: Server[]) => {
    try {
      await api('/mcp/servers', 'PUT', { servers });
      setError('');
      load();
    } catch (e) {
      setError(t('mcp.error', { error: e instanceof Error ? e.message : '' }));
    }
  };

  const add = () => {
    const server: Server =
      form.transport === 'stdio'
        ? {
            name: form.name.trim(),
            transport: 'stdio',
            command: form.command.trim(),
            args: form.args
              .split('\n')
              .map((a) => a.trim())
              .filter(Boolean),
            env: pairs(form.env),
          }
        : {
            name: form.name.trim(),
            transport: 'http',
            url: form.url.trim(),
            headers: pairs(form.env),
          };
    void save([...(info?.servers ?? []), server]).then(() =>
      setForm({
        name: '',
        transport: 'stdio',
        command: '',
        args: '',
        env: '',
        url: '',
      }),
    );
  };

  const setPolicy = async (server: string, tool: string, policy: Policy) => {
    // Show the choice at once; the saved policies come back from the server.
    setInfo((current) =>
      current
        ? {
            ...current,
            policies: { ...current.policies, [`${server}/${tool}`]: policy },
          }
        : current,
    );
    try {
      const saved = await api<{ policies: Record<string, Policy> }>(
        '/mcp/tools',
        'PUT',
        { server, tool, policy },
      );
      setInfo((current) =>
        current ? { ...current, policies: saved.policies } : current,
      );
    } catch (e) {
      setError(t('mcp.error', { error: e instanceof Error ? e.message : '' }));
      load();
    }
  };

  return (
    <div className="mcp-settings">
      <p className="small muted">{t('mcp.hint')}</p>
      {loading && <p className="small muted">{t('mcp.connecting')}</p>}
      {info?.servers.length === 0 && (
        <p className="small muted">{t('mcp.empty')}</p>
      )}
      {info?.servers.map((s) => {
        const status = info.status.find((x) => x.name === s.name);
        return (
          <div key={s.name} className="mcp-server">
            <div className="row">
              <strong>{s.name}</strong>
              <span
                className={`badge ${status?.connected ? 'status-verified' : 'status-failed'}`}
              >
                {t(status?.connected ? 'mcp.connected' : 'mcp.notConnected')}
              </span>
              <span className="spacer" />
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  if (window.confirm(t('mcp.removeConfirm', { name: s.name })))
                    void save(info.servers.filter((x) => x.name !== s.name));
                }}
              >
                {t('mcp.remove')}
              </button>
            </div>
            <span className="small muted mono">
              {s.transport === 'stdio'
                ? [s.command, ...s.args].join(' ')
                : s.url}
            </span>
            {status?.error && <p className="error small">{status.error}</p>}
            {status?.tools.map((tool) => (
              <div key={tool.name} className="row mcp-tool">
                <span className="mono small">{tool.name}</span>
                <span className="small muted mcp-desc">{tool.description}</span>
                <select
                  aria-label={t('mcp.policyFor', { tool: tool.name })}
                  value={info.policies[`${s.name}/${tool.name}`] ?? 'ask'}
                  onChange={(e) =>
                    void setPolicy(s.name, tool.name, e.target.value as Policy)
                  }
                >
                  {POLICIES.map((p) => (
                    <option key={p} value={p}>
                      {t(`mcp.policy.${p}`)}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        );
      })}
      <details className="mcp-add">
        <summary>{t('mcp.add')}</summary>
        <div className="fields">
          <label>
            {t('mcp.name')}
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </label>
          <label>
            {t('mcp.transport')}
            <select
              value={form.transport}
              onChange={(e) =>
                setForm({
                  ...form,
                  transport: e.target.value as 'stdio' | 'http',
                })
              }
            >
              <option value="stdio">{t('mcp.transport.stdio')}</option>
              <option value="http">{t('mcp.transport.http')}</option>
            </select>
          </label>
          {form.transport === 'stdio' ? (
            <>
              <label>
                {t('mcp.command')}
                <input
                  className="mono"
                  value={form.command}
                  onChange={(e) =>
                    setForm({ ...form, command: e.target.value })
                  }
                />
              </label>
              <label>
                {t('mcp.args')}
                <textarea
                  className="mono"
                  rows={3}
                  value={form.args}
                  onChange={(e) => setForm({ ...form, args: e.target.value })}
                />
              </label>
            </>
          ) : (
            <label>
              {t('mcp.url')}
              <input
                className="mono"
                value={form.url}
                onChange={(e) => setForm({ ...form, url: e.target.value })}
              />
            </label>
          )}
          <label>
            {t(form.transport === 'stdio' ? 'mcp.env' : 'mcp.headers')}
            <textarea
              className="mono"
              rows={2}
              value={form.env}
              onChange={(e) => setForm({ ...form, env: e.target.value })}
            />
          </label>
        </div>
        <div className="row end">
          <button
            type="button"
            className="primary"
            disabled={
              !form.name.trim() ||
              (form.transport === 'stdio'
                ? !form.command.trim()
                : !form.url.trim())
            }
            onClick={add}
          >
            {t('mcp.save')}
          </button>
        </div>
      </details>
      {error && (
        <p className="error small" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
