// Outbound allowlist for this process: loopback plus the model endpoints the user chose.
// Anything else (telemetry, analytics, update checks in a dependency) is refused and logged.
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);

export class EgressGuard {
  private readonly allowed = new Set<string>();
  readonly blocked: string[] = [];
  private readonly report: (host: string) => void;

  constructor(
    report: (host: string) => void = (host) =>
      console.warn(`blocked outbound request to ${host}`),
  ) {
    this.report = report;
  }

  /** Allows a host the user configured or explicitly tested. */
  allow(url: string): void {
    this.allowed.add(new URL(url).hostname);
  }

  permits(url: string): boolean {
    const host = new URL(url).hostname;
    return LOOPBACK.has(host) || this.allowed.has(host);
  }

  wrap(fetchImpl: typeof fetch): typeof fetch {
    return (input, init) => {
      const url = input instanceof Request ? input.url : String(input);
      if (!this.permits(url)) {
        const host = new URL(url).hostname;
        this.blocked.push(host);
        this.report(host);
        return Promise.reject(new Error(`egress-blocked: ${host}`));
      }
      return fetchImpl(input, init);
    };
  }

  install(): void {
    globalThis.fetch = this.wrap(globalThis.fetch);
  }
}
