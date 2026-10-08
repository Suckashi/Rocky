// MCP settings: servers (env and header values never go back to the browser) and the
// per-tool approval choice. HTTP servers join the outbound allowlist when saved.
import { Hono } from 'hono';
import { z } from 'zod';
import type { McpManager, McpServerConfig } from '../../mcp/manager.ts';
import type { EgressGuard } from '../../platform/egress.ts';
import type { SettingsStore } from '../../store/settings.ts';

/** Stands in for a saved secret value; sending it back keeps the saved value. */
export const SAVED = '••••';

const name = z
  .string()
  .trim()
  .regex(/^[\w-]{1,40}$/);
const record = z.record(
  z.string().regex(/^[\w.-]{1,100}$/),
  z.string().max(4000),
);
const server = z.discriminatedUnion('transport', [
  z
    .object({
      name,
      transport: z.literal('stdio'),
      command: z.string().trim().min(1).max(1000),
      args: z.array(z.string().max(2000)).max(100),
      env: record,
      cwd: z.string().max(1000).optional(),
    })
    .strict(),
  z
    .object({
      name,
      transport: z.literal('http'),
      url: z
        .string()
        .url()
        .refine((u) => /^https?:\/\//.test(u)),
      headers: record,
    })
    .strict(),
]);

function mask(config: McpServerConfig): McpServerConfig {
  const hide = (r: Record<string, string>) =>
    Object.fromEntries(Object.keys(r).map((k) => [k, SAVED]));
  return config.transport === 'stdio'
    ? { ...config, env: hide(config.env) }
    : { ...config, headers: hide(config.headers) };
}

/** Values the browser sent as SAVED keep what was stored. */
function unmask(
  next: McpServerConfig,
  old: McpServerConfig | undefined,
): McpServerConfig {
  const keep = (
    r: Record<string, string>,
    prev: Record<string, string> | undefined,
  ) =>
    Object.fromEntries(
      Object.entries(r).map(([k, v]) => [
        k,
        v === SAVED ? (prev?.[k] ?? '') : v,
      ]),
    );
  if (next.transport === 'stdio')
    return {
      ...next,
      env: keep(next.env, old?.transport === 'stdio' ? old.env : undefined),
    };
  return {
    ...next,
    headers: keep(
      next.headers,
      old?.transport === 'http' ? old.headers : undefined,
    ),
  };
}

export function mcpRoutes(deps: {
  settings: SettingsStore;
  manager: McpManager;
  egress: Pick<EgressGuard, 'allow'>;
}): Hono {
  const { settings, manager, egress } = deps;
  const app = new Hono();

  app.get('/mcp', async (c) => {
    const servers = settings.mcpServers();
    const status = await manager.refresh(servers);
    return c.json({
      servers: servers.map(mask),
      status,
      policies: settings.toolPolicies(),
    });
  });

  app.put('/mcp/servers', async (c) => {
    const parsed = z
      .object({ servers: z.array(server).max(50) })
      .strict()
      .safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'invalid-mcp' }, 400);
    const names = parsed.data.servers.map((s) => s.name);
    if (new Set(names).size !== names.length)
      return c.json({ error: 'duplicate-name' }, 400);
    const old = new Map(settings.mcpServers().map((s) => [s.name, s]));
    const servers = parsed.data.servers.map((s) =>
      unmask(s as McpServerConfig, old.get(s.name)),
    );
    for (const s of servers) if (s.transport === 'http') egress.allow(s.url);
    settings.setMcpServers(servers);
    return c.json({ servers: servers.map(mask) });
  });

  app.put('/mcp/tools', async (c) => {
    const parsed = z
      .object({
        server: name,
        tool: z.string().min(1).max(200),
        policy: z.enum(['ask', 'read-only', 'deny']),
      })
      .strict()
      .safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'invalid-policy' }, 400);
    settings.setToolPolicy(
      parsed.data.server,
      parsed.data.tool,
      parsed.data.policy,
    );
    return c.json({ policies: settings.toolPolicies() });
  });

  return app;
}
