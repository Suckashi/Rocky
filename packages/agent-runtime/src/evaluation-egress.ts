// Process-local Fetch boundary for the dedicated trusted evaluation command.
// It is not an OS sandbox and never grants arbitrary loopback access.
const endpoints = new Map<string, number>();
let activeGuard:
  { denied: { destination: string; reason: string }[] } | undefined;
export function allowEvaluationEndpoint(url: string) {
  const href = new URL(url).href;
  endpoints.set(href, (endpoints.get(href) ?? 0) + 1);
  let revoked = false;
  return () => {
    if (revoked) return;
    revoked = true;
    const count = endpoints.get(href)! - 1;
    if (count) endpoints.set(href, count);
    else endpoints.delete(href);
  };
}
export const allowFixtureEndpoint = allowEvaluationEndpoint;
export function assertEvaluationEgress(input: string) {
  if (!activeGuard) return;
  const url = new URL(input);
  if (url.username || url.password || !endpoints.has(url.href)) {
    activeGuard.denied.push({
      destination: url.origin + url.pathname,
      reason: "not configured for this evaluation",
    });
    throw Error("Rocky evaluation egress denied: " + url.origin);
  }
}
export function installEvaluationEgressGuard() {
  if (activeGuard) throw Error("Evaluation guard already installed");
  const original = globalThis.fetch;
  const denied: { destination: string; reason: string }[] = [];
  activeGuard = { denied };
  globalThis.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    assertEvaluationEgress(url.href);
    return original(input, { ...init, redirect: "manual" });
  };
  return {
    denied,
    restore: () => {
      globalThis.fetch = original;
      activeGuard = undefined;
    },
  };
}
