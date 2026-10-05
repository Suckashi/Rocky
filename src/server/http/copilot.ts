// The CopilotKit runtime, served by Rocky: local runner, no Intelligence, no telemetry.
import {
  CopilotRuntime,
  createCopilotHonoHandler,
} from '@copilotkit/runtime/v2';
import type { Hono } from 'hono';
import type { RockyAgent } from '../agent/rocky-agent.ts';
import type { RockyAgentRunner } from '../agent/runner.ts';

export const COPILOT_BASE_PATH = '/api/copilotkit';

export function copilotRoutes(
  agent: RockyAgent,
  runner: RockyAgentRunner,
): Hono {
  // start.ts sets the opt-out before CopilotKit loads; this keeps /info honest in tests too.
  process.env['COPILOTKIT_TELEMETRY_DISABLED'] = 'true';
  const runtime = new CopilotRuntime({ agents: { rocky: agent }, runner });
  return createCopilotHonoHandler({
    runtime,
    basePath: COPILOT_BASE_PATH,
  }) as unknown as Hono;
}
