import { RockyError } from "../../contracts/src/index.js";
export class ExplicitNetwork {
  readonly trace: { url: string; purpose: string; allowed: boolean }[] = [];
  constructor(private readonly endpoints: ReadonlyMap<string, string>) {}
  async request(url: string, purpose: string, init: RequestInit = {}) {
    const parsed = new URL(url),
      configured = this.endpoints.get(purpose);
    const allowed =
      !parsed.username &&
      !parsed.password &&
      !!configured &&
      parsed.href === new URL(configured).href;
    this.trace.push({ url: parsed.origin + parsed.pathname, purpose, allowed });
    if (!allowed)
      throw new RockyError(
        "network_denied",
        "Destination is not explicitly configured",
        403,
      );
    const response = await fetch(parsed, {
      ...init,
      redirect: "manual",
      signal: init.signal ?? AbortSignal.timeout(10000),
    });
    if (response.status >= 300 && response.status < 400)
      throw new RockyError(
        "redirect_denied",
        "Redirect requires a separate configured destination",
        403,
      );
    return response;
  }
}
