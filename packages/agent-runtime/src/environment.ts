// Execute before importing SDKs, including their transitive telemetry clients.
process.env.COPILOTKIT_TELEMETRY_DISABLED = "true";
process.env.SCARF_NO_ANALYTICS = "true";
process.env.PROMPTFOO_DISABLE_TELEMETRY = "1";
process.env.PROMPTFOO_DISABLE_UPDATE = "1";
process.env.LANGSMITH_TRACING = "false";
process.env.LANGCHAIN_TRACING_V2 = "false";
