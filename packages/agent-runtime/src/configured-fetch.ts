import { fetch as networkFetch } from "undici";
import { createConnectionDispatcher } from "./model-network.js";
import { ModelDnsPolicy } from "./model-dns.js";
import type { ModelConfig } from "../../contracts/src/models.js";
import { RockyError } from "../../contracts/src/index.js";
import { assertEvaluationEgress } from "./evaluation-egress.js";

export function configuredFetch(
  config: Pick<ModelConfig, "baseUrl" | "proxy" | "caRef">,
  env: NodeJS.ProcessEnv,
  dnsPolicy = new ModelDnsPolicy(),
) {
  const dispatcher = createConnectionDispatcher(config, env, dnsPolicy);
  const endpoint = new URL(config.baseUrl).href;
  const fetcher: typeof globalThis.fetch = async (input, init = {}) => {
    const url = input instanceof Request ? input.url : String(input);
    if (new URL(url).href !== endpoint)
      throw new RockyError(
        "network_denied",
        "Destination is not the configured MCP endpoint",
        403,
      );
    if (
      init.body !== undefined &&
      init.body !== null &&
      typeof init.body !== "string"
    )
      throw new RockyError(
        "network_body",
        "MCP requests require serialized JSON",
        400,
      );
    assertEvaluationEgress(url);
    try {
      const response = await networkFetch(url, {
        method: init.method,
        headers: Object.fromEntries(new Headers(init.headers)),
        body: init.body,
        signal: init.signal,
        redirect: "manual",
        dispatcher,
      });
      return new Response(
        response.body as unknown as ReadableStream<Uint8Array> | null,
        {
          status: response.status,
          statusText: response.statusText,
          headers: Object.fromEntries(response.headers),
        },
      );
    } catch {
      throw new RockyError(
        init.signal?.aborted ? "request_cancelled" : "connection_failed",
        "Configured MCP endpoint request did not complete",
        502,
      );
    }
  };
  return {
    fetch: fetcher,
    close: async () => {
      await dispatcher.destroy();
    },
  };
}
