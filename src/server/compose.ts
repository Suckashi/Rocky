// Builds every part of Rocky from a data folder. main.ts and the integration tests share it,
// so tests exercise the same wiring as the real server.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { RockyAgent } from './agent/rocky-agent.ts';
import { RockyAgentRunner } from './agent/runner.ts';
import { Executor } from './effects/execute.ts';
import { Gate } from './effects/gate.ts';
import { builtInSafeList } from './effects/policy.ts';
import { ReceiptStore } from './effects/receipts.ts';
import { RuleStore } from './effects/rules.ts';
import { SnapshotStore } from './effects/snapshots.ts';
import { createApp } from './http/app.ts';
import { copilotRoutes } from './http/copilot.ts';
import { LoginCodes } from './http/login-codes.ts';
import { approvalRoutes } from './http/routes/approvals.ts';
import { settingsRoutes, type ListModels } from './http/routes/settings.ts';
import { threadRoutes } from './http/routes/threads.ts';
import { EgressGuard } from './platform/egress.ts';
import { openDatabase } from './store/db.ts';
import { SettingsStore } from './store/settings.ts';
import { ThreadStore } from './store/threads.ts';

export interface ComposeOptions {
  dataDir: string;
  token: string;
  port: number;
  webRoot?: string;
  egress?: EgressGuard;
  listModels?: ListModels;
}

function packageScripts(projectRoot: string): Record<string, string> {
  try {
    const pkg = JSON.parse(
      readFileSync(join(projectRoot, 'package.json'), 'utf8'),
    ) as { scripts?: Record<string, string> };
    return pkg.scripts ?? {};
  } catch {
    return {};
  }
}

export function composeRocky(options: ComposeOptions) {
  const db = openDatabase(join(options.dataDir, 'rocky.sqlite'));
  const threads = new ThreadStore(db);
  const settings = new SettingsStore(db, options.dataDir);
  const receipts = new ReceiptStore(db);
  const snapshots = new SnapshotStore(db, options.dataDir);
  const rules = new RuleStore(db);
  const interruptedActions = receipts.markInterrupted();
  const gate = new Gate({
    receipts,
    projectRoot: () => settings.project(),
    defaultMode: () => settings.mode(),
    rules: () => rules.list(),
    safeList: (root) => builtInSafeList(packageScripts(root)),
    createdByRocky: (threadId, path) =>
      snapshots
        .forReceipts(receipts.forThread(threadId).map((r) => r.id))
        .some((s) => s.path === path && s.beforeSha === null),
  });
  const executor = new Executor({ passes: gate.passes, receipts, snapshots });
  const runner = new RockyAgentRunner(threads);
  const agent = new RockyAgent({ settings, gate, executor });
  const egress = options.egress ?? new EgressGuard();
  const savedModel = settings.model();
  if (savedModel) egress.allow(savedModel.baseURL);
  const codes = new LoginCodes();
  const app = createApp({
    token: options.token,
    codes,
    port: options.port,
    api: [
      settingsRoutes(settings, egress, options.listModels),
      threadRoutes(threads, runner),
      approvalRoutes(gate, receipts, snapshots, executor),
    ],
    mounted: [copilotRoutes(agent, runner)],
    ...(options.webRoot ? { webRoot: options.webRoot } : {}),
  });
  return {
    app,
    db,
    codes,
    threads,
    settings,
    receipts,
    snapshots,
    rules,
    gate,
    executor,
    runner,
    agent,
    egress,
    interruptedActions,
  };
}
