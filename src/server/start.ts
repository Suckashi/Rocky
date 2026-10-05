// Entry point. CopilotKit decides at import time whether to send telemetry, so every
// opt-out must be in the environment before any other module loads.
process.env['COPILOTKIT_TELEMETRY_DISABLED'] = 'true';
process.env['DO_NOT_TRACK'] = '1';
process.env['LANGSMITH_TRACING'] = 'false';
process.env['LANGCHAIN_TRACING_V2'] = 'false';
await import('./main.ts');
