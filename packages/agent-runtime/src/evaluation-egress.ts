// Process-local Fetch boundary for the dedicated trusted evaluation command.
// It is not an OS sandbox and never grants arbitrary loopback access.
const endpoints = new Set<string>();
export function allowFixtureEndpoint(url: string) {
  endpoints.add(new URL(url).href);
  return () => endpoints.delete(new URL(url).href);
}
export function installEvaluationEgressGuard() {
  const original = globalThis.fetch;
  const denied: { destination: string; reason: string }[] = [];
  globalThis.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.username || url.password || !endpoints.has(url.href)) {
      denied.push({
        destination: url.origin + url.pathname,
        reason: "not configured for this evaluation",
      });
      throw Error("Rocky evaluation egress denied: " + url.origin);
    }
    return original(input, { ...init, redirect: "manual" });
  };
  return {
    denied,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}
