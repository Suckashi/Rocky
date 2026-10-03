import { Agent, ProxyAgent, fetch, type Dispatcher } from "undici";
import { getCACertificates } from "node:tls";
import {
  endpointSchema,
  type ModelConfig,
} from "../../contracts/src/models.js";
import { RockyError } from "../../contracts/src/index.js";

export function bypassProxy(url: URL, patterns: string): boolean {
  const host = url.hostname.toLowerCase();
  const port = url.port || (url.protocol === "https:" ? "443" : "80");
  return patterns
    .split(/[\s,]+/)
    .filter(Boolean)
    .some((entry) => {
      if (entry === "*") return true;
      const match = /^(\[[^\]]+\]|[^:]+)(?::(\d+))?$/.exec(entry.toLowerCase());
      if (!match || (match[2] && match[2] !== port)) return false;
      const name = match[1]!.replace(/^\*?\./, "");
      return (
        host === name || (!name.startsWith("[") && host.endsWith("." + name))
      );
    });
}

export function resolveProxy(
  config: ModelConfig,
  env: NodeJS.ProcessEnv,
): string | undefined {
  if (config.proxy.mode === "direct") return;
  if (config.proxy.mode === "explicit")
    return endpointSchema.parse(config.proxy.url);
  const url = new URL(config.baseUrl);
  // Lowercase wins when both variants exist; an explicitly empty value disables it.
  if (bypassProxy(url, env.no_proxy ?? env.NO_PROXY ?? "")) return;
  const value =
    url.protocol === "https:"
      ? (env.https_proxy ?? env.HTTPS_PROXY)
      : (env.http_proxy ?? env.HTTP_PROXY);
  return value ? endpointSchema.parse(value) : undefined;
}

/** One dispatcher per connection snapshot. Never changes global TLS/proxy state. */
export class ModelNetwork {
  private readonly dispatcher: Dispatcher;
  readonly endpoint: string;
  private readonly headers: Record<string, string>;
  constructor(config: ModelConfig, env: NodeJS.ProcessEnv = process.env) {
    const base = endpointSchema.parse(config.baseUrl);
    this.endpoint =
      base +
      (config.provider === "anthropic" ? "/messages" : "/chat/completions");
    const credential = config.credentialRef
      ? env[config.credentialRef]
      : undefined;
    if (config.credentialRef && !credential)
      throw new RockyError(
        "credential_unavailable",
        "Credential reference is unavailable in the daemon",
        409,
      );
    const ca = config.caRef ? env[config.caRef] : undefined;
    if (config.caRef && !ca)
      throw new RockyError(
        "ca_unavailable",
        "CA reference is unavailable in the daemon",
        409,
      );
    const tls = {
      rejectUnauthorized: true,
      ...(ca ? { ca: [...getCACertificates("default"), ca] } : {}),
    };
    const proxy = resolveProxy(config, env);
    this.dispatcher = proxy
      ? new ProxyAgent({
          uri: proxy,
          requestTls: tls,
          proxyTls: { rejectUnauthorized: true },
        })
      : new Agent({ connect: tls });
    this.headers = { "content-type": "application/json" };
    if (config.provider === "anthropic") {
      this.headers["anthropic-version"] = "2023-06-01";
      if (credential) this.headers["x-api-key"] = credential;
    } else if (credential) this.headers.authorization = `Bearer ${credential}`;
  }
  async post(body: unknown, signal: AbortSignal) {
    try {
      const response = await fetch(this.endpoint, {
        method: "POST",
        body: JSON.stringify(body),
        headers: this.headers,
        redirect: "manual",
        dispatcher: this.dispatcher,
        signal,
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw new RockyError(
          response.status >= 300 && response.status < 400
            ? "redirect_denied"
            : "provider_rejected",
          "Configured endpoint rejected the request",
          502,
        );
      }
      return response;
    } catch (error) {
      if (error instanceof RockyError) throw error;
      // SDK errors may embed URLs, headers or response bodies. Keep them server-private.
      throw new RockyError(
        signal.aborted ? "request_cancelled" : "connection_failed",
        "Configured endpoint request did not complete",
        502,
      );
    }
  }
  async close() {
    await this.dispatcher.destroy();
  }
}
